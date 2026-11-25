//! The GitHub account: signing in through git's credential helper (Git
//! Credential Manager on Windows, which shows GitHub's own sign-in), or
//! with a personal access token, and calling GitHub's REST API with it.
//!
//! The token is never handed to the UI. It lives in the credential helper,
//! where git's own pushes and pulls to github.com find it too, and in
//! memory while Gitizen runs.

use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;

use crate::git::runner::{git_command, run_command_with_input};
use crate::util::blocking;

/// The signed-in GitHub user, as the UI shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubAccount {
    pub login: String,
    /// The profile's display name, if set.
    pub name: Option<String>,
    pub avatar_url: String,
}

#[derive(Clone)]
struct Session {
    account: GitHubAccount,
    token: String,
}

/// The signed-in account and its token, kept in Tauri's managed state.
/// Empty until the first command that needs it looks for a saved sign-in.
/// Clones share the same slot, so one can go to a blocking thread.
#[derive(Default, Clone)]
pub struct GitHubSession(Arc<Mutex<Option<Session>>>);

/// How commands receive the GitHub session from Tauri's managed state.
pub type GitHub<'a> = tauri::State<'a, GitHubSession>;

impl GitHubSession {
    fn current(&self) -> Option<Session> {
        self.0.lock().ok()?.clone()
    }

    fn set(&self, session: Option<Session>) {
        if let Ok(mut slot) = self.0.lock() {
            *slot = session;
        }
    }

    /// The signed-in account, picking up a sign-in the credential helper
    /// saved earlier (without showing any window) the first time.
    fn load(&self) -> Option<Session> {
        if let Some(session) = self.current() {
            return Some(session);
        }
        let (_, token) = credential_fill(false).ok()?;
        let account = fetch_account(&token).ok()?;
        let session = Session { account, token };
        self.set(Some(session.clone()));
        Some(session)
    }

    /// The token of the signed-in account, for API calls. May ask the
    /// credential helper and GitHub, so call it on a blocking thread.
    pub(crate) fn token(&self) -> Result<String, String> {
        self.load()
            .map(|session| session.token)
            .ok_or_else(|| "Sign in to GitHub first.".to_string())
    }
}

/// The signed-in GitHub account, or null. A sign-in saved by the credential
/// helper (from an earlier run, or from git itself) counts.
#[tauri::command]
pub async fn github_account(github: GitHub<'_>) -> Result<Option<GitHubAccount>, String> {
    let github = github.inner().clone();
    blocking(move || Ok(github.load().map(|session| session.account))).await
}

/// Signs in with git's credential helper, which shows its own sign-in
/// window (Git Credential Manager: through the browser) unless it already
/// has a GitHub sign-in. The sign-in is saved for git and later runs.
#[tauri::command]
pub async fn github_sign_in(github: GitHub<'_>) -> Result<GitHubAccount, String> {
    let session = blocking(sign_in_interactively).await?;
    github.set(Some(session.clone()));
    Ok(session.account)
}

fn sign_in_interactively() -> Result<Session, String> {
    let not_signed_in = |error: String| {
        format!(
            "Git's credential helper didn't sign in to GitHub ({error}). Git Credential Manager \
             comes with Git for Windows; elsewhere, sign in with a personal access token instead."
        )
    };
    let (user, token) = credential_fill(true).map_err(not_signed_in)?;
    let (user, token, account) = match fetch_account(&token) {
        Ok(account) => (user, token, account),
        // A saved sign-in GitHub no longer accepts (revoked or expired):
        // forget it and ask again.
        Err(ApiError::Unauthorized) => {
            let _ = credential_store("reject", &user, &token);
            let (user, token) = credential_fill(true).map_err(not_signed_in)?;
            let account = fetch_account(&token).map_err(String::from)?;
            (user, token, account)
        }
        Err(error) => return Err(error.into()),
    };
    // Tells the helper the sign-in worked, so it keeps it.
    let _ = credential_store("approve", &user, &token);
    Ok(Session { account, token })
}

/// Signs in with a personal access token, which is checked with GitHub and
/// saved in git's credential helper like any other GitHub sign-in.
#[tauri::command]
pub async fn github_sign_in_with_token(github: GitHub<'_>, token: String) -> Result<GitHubAccount, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Paste a personal access token.".into());
    }
    let session = blocking(move || {
        let account = fetch_account(&token).map_err(String::from)?;
        // Saving can fail without a credential helper; the token still works
        // for this run.
        let _ = credential_store("approve", &account.login, &token);
        Ok(Session { account, token })
    })
    .await?;
    github.set(Some(session.clone()));
    Ok(session.account)
}

/// Signs out: removes the GitHub sign-in from git's credential helper, so
/// git asks again the next time it needs one too.
#[tauri::command]
pub async fn github_sign_out(github: GitHub<'_>) -> Result<(), String> {
    let session = github.current();
    github.set(None);
    if let Some(Session { account, token }) = session {
        blocking(move || credential_store("reject", &account.login, &token)).await?;
    }
    Ok(())
}

// ---- git's credential helper -------------------------------------------------

/// What git's credential helper is asked about: GitHub over https.
const GITHUB_HOST: &str = "protocol=https\nhost=github.com\n";

/// Runs `git credential <action>` with `input`. Not `interactive` means the
/// helper must answer from what it has saved, without showing a window.
fn credential(action: &str, input: &str, interactive: bool) -> Result<String, String> {
    // Any folder will do; the helper is set up in git's global config.
    let mut command = git_command(&std::env::temp_dir(), ["credential", action]);
    if !interactive {
        command.env("GCM_INTERACTIVE", "never");
    }
    let output = run_command_with_input(command, input)?;
    Ok(String::from_utf8_lossy(&output).into_owned())
}

/// The saved (or, when `interactive`, newly signed-in) GitHub user and token.
fn credential_fill(interactive: bool) -> Result<(String, String), String> {
    let output = credential("fill", &format!("{GITHUB_HOST}\n"), interactive)?;
    parse_credential(&output).ok_or_else(|| "no GitHub sign-in was returned".to_string())
}

/// Tells the helper to keep ("approve") or forget ("reject") a sign-in.
fn credential_store(action: &str, user: &str, token: &str) -> Result<(), String> {
    credential(action, &format!("{GITHUB_HOST}username={user}\npassword={token}\n\n"), false).map(drop)
}

/// Username and password from `git credential fill`'s "key=value" lines.
fn parse_credential(output: &str) -> Option<(String, String)> {
    let value = |key: &str| {
        output
            .lines()
            .find_map(|line| line.strip_prefix(key)?.strip_prefix('='))
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    Some((value("username")?, value("password")?))
}

// ---- GitHub's REST API ----------------------------------------------------------

/// Why an API call failed.
#[derive(Debug)]
pub(crate) enum ApiError {
    /// The token isn't (or is no longer) accepted.
    Unauthorized,
    /// Anything else, as a message for the user.
    Other(String),
}

impl From<ApiError> for String {
    fn from(error: ApiError) -> Self {
        match error {
            ApiError::Unauthorized => {
                "GitHub didn't accept the sign-in. Sign out and sign in to GitHub again.".into()
            }
            ApiError::Other(message) => message,
        }
    }
}

fn request(method: &str, path: &str, token: &str) -> ureq::Request {
    ureq::request(method, &format!("https://api.github.com{path}"))
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", "2022-11-28")
        .set("User-Agent", "Gitizen")
}

fn into_json(result: Result<ureq::Response, ureq::Error>) -> Result<Value, ApiError> {
    match result {
        Ok(response) => response
            .into_json()
            .map_err(|error| ApiError::Other(format!("GitHub sent an unreadable answer: {error}"))),
        Err(ureq::Error::Status(401, _)) => Err(ApiError::Unauthorized),
        Err(ureq::Error::Status(status, response)) => {
            let body = response.into_string().unwrap_or_default();
            Err(ApiError::Other(error_message(status, &body)))
        }
        Err(ureq::Error::Transport(error)) => {
            Err(ApiError::Other(format!("Couldn't reach GitHub: {error}")))
        }
    }
}

/// GitHub's message for a failed call, with the details it gives per field
/// (e.g. "name already exists on this account").
fn error_message(status: u16, body: &str) -> String {
    let json: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let mut message = json["message"].as_str().unwrap_or("Request failed").to_string();
    let details: Vec<&str> = json["errors"]
        .as_array()
        .map(|errors| errors.iter().filter_map(|error| error["message"].as_str()).collect())
        .unwrap_or_default();
    if !details.is_empty() {
        message = format!("{message} {}", details.join("; "));
    }
    format!("GitHub refused the request ({status}): {message}")
}

/// GETs `path` (e.g. "/user") from the API.
pub(crate) fn get(token: &str, path: &str) -> Result<Value, ApiError> {
    into_json(request("GET", path, token).call())
}

/// POSTs `body` as JSON to `path`.
pub(crate) fn post(token: &str, path: &str, body: Value) -> Result<Value, ApiError> {
    into_json(request("POST", path, token).send_json(body))
}

fn fetch_account(token: &str) -> Result<GitHubAccount, ApiError> {
    account_from(&get(token, "/user")?)
        .ok_or_else(|| ApiError::Other("GitHub didn't say who is signed in.".into()))
}

fn account_from(user: &Value) -> Option<GitHubAccount> {
    Some(GitHubAccount {
        login: user["login"].as_str()?.to_string(),
        name: user["name"].as_str().filter(|name| !name.is_empty()).map(str::to_string),
        avatar_url: user["avatar_url"].as_str().unwrap_or_default().to_string(),
    })
}

/// Creates a repository on the signed-in account and returns its https
/// clone URL.
pub(crate) fn create_repository(token: &str, name: &str, description: &str, private: bool) -> Result<String, String> {
    let body = serde_json::json!({ "name": name, "description": description, "private": private });
    let repository = post(token, "/user/repos", body)?;
    repository["clone_url"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "GitHub didn't return the new repository's URL.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_credential_helper_output() {
        let output = "protocol=https\nhost=github.com\nusername=octo\npassword=gho_abc\n";
        assert_eq!(parse_credential(output), Some(("octo".into(), "gho_abc".into())));
        assert_eq!(parse_credential("protocol=https\nhost=github.com\n"), None);
        assert_eq!(parse_credential("username=octo\npassword=\n"), None);
    }

    #[test]
    fn explains_api_failures() {
        let body = r#"{"message":"Repository creation failed.","errors":[{"message":"name already exists on this account"}]}"#;
        assert_eq!(
            error_message(422, body),
            "GitHub refused the request (422): Repository creation failed. name already exists on this account"
        );
        assert_eq!(error_message(500, "oops"), "GitHub refused the request (500): Request failed");
    }

    #[test]
    fn reads_the_signed_in_user() {
        let user = serde_json::json!({ "login": "octo", "name": "", "avatar_url": "https://a/1" });
        assert_eq!(
            account_from(&user),
            Some(GitHubAccount { login: "octo".into(), name: None, avatar_url: "https://a/1".into() })
        );
        assert_eq!(account_from(&serde_json::json!({})), None);
    }
}
