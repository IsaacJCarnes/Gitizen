import { useState } from "react";
import { useAppContext } from "../../context/AppContext";
import ActionModal from "../common/ActionModal";

interface SignInModalProps {
  onDismiss: () => void;
}

/**
 * Signs in to GitHub: through git's credential helper (Git Credential
 * Manager opens GitHub's sign-in in the browser), or with a pasted personal
 * access token for setups without one.
 */
export default function SignInModal({ onDismiss }: SignInModalProps): React.JSX.Element {
  const { github } = useAppContext();
  const [token, setToken] = useState("");
  const [working, setWorking] = useState<"browser" | "token" | null>(null);

  const run = async (how: "browser" | "token"): Promise<void> => {
    setWorking(how);
    const ok = await (how === "browser" ? github.signIn() : github.signInWithToken(token));
    setWorking(null);
    if (ok) onDismiss();
  };

  return (
    <ActionModal
      title="Sign in to GitHub"
      onDismiss={onDismiss}
      actions={[
        {
          label: working === "browser" ? "Waiting for the browser…" : "Sign in with browser",
          primary: true,
          disabled: working !== null,
          onClick: () => void run("browser"),
        },
      ]}
    >
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (token.trim() && !working) void run("token");
        }}
      >
        <p className="hint">
          Git Credential Manager opens GitHub in your browser to sign in. Git uses the same sign-in
          to push and pull, so you won't be asked again there.
        </p>
        <label>
          Or paste a personal access token
          <span className="field-row">
            <input
              type="password"
              value={token}
              placeholder="ghp_… or github_pat_…"
              autoComplete="off"
              onChange={(event) => setToken(event.target.value)}
            />
            <button type="submit" disabled={!token.trim() || working !== null}>
              {working === "token" ? "Checking…" : "Use token"}
            </button>
          </span>
        </label>
        <p className="hint">
          A classic token needs the <code>repo</code> scope to list, create and push to your
          repositories.
        </p>
      </form>
    </ActionModal>
  );
}
