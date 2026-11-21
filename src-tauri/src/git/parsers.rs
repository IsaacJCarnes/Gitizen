//! Pure functions that turn raw git output into the shared data types.
//! Kept free of Tauri and process handling so they are easy to unit test.

use super::types::{CommitFile, FileChange, GitCommit, GitRef, GitStatus, RefType};

/// Field and record separators used in the `git log --format` string.
const FIELD_SEP: char = '\x1f';
const RECORD_SEP: char = '\x1e';

/// `--format` for `git log` that `parse_log` understands:
/// hash, parents, decoration, author, author date, subject, body.
pub const LOG_FORMAT: &str = "%H%x1f%P%x1f%D%x1f%an%x1f%aI%x1f%s%x1f%b%x1e";

/// Parses a `%D` decoration produced with `--decorate=full`, e.g.
/// "HEAD -> refs/heads/main, tag: refs/tags/v1, refs/remotes/origin/main".
/// Symbolic remote HEADs such as "origin/HEAD" are dropped.
pub fn parse_refs(decoration: &str) -> Vec<GitRef> {
    let make = |name: &str, ref_type: RefType, current: bool| GitRef {
        name: name.to_string(),
        ref_type,
        current: current.then_some(true),
    };

    decoration
        .split(", ")
        .filter(|part| !part.is_empty())
        .map(|part| {
            if let Some(name) = part.strip_prefix("HEAD -> refs/heads/") {
                make(name, RefType::Branch, true)
            } else if part == "HEAD" {
                make("HEAD", RefType::Head, true)
            } else if let Some(name) = part.strip_prefix("tag: refs/tags/") {
                make(name, RefType::Tag, false)
            } else if let Some(name) = part.strip_prefix("refs/heads/") {
                make(name, RefType::Branch, false)
            } else if let Some(name) = part.strip_prefix("refs/remotes/") {
                make(name, RefType::Remote, false)
            } else {
                make(part, RefType::Branch, false)
            }
        })
        .filter(|git_ref| !git_ref.name.ends_with("/HEAD"))
        .collect()
}

/// Parses `git log` output written with `LOG_FORMAT`.
pub fn parse_log(output: &str) -> Vec<GitCommit> {
    output
        .split(RECORD_SEP)
        .map(|record| record.strip_prefix('\n').unwrap_or(record))
        .filter(|record| !record.is_empty())
        .map(|record| {
            let mut fields = record.split(FIELD_SEP);
            let mut next = || fields.next().unwrap_or_default();
            let hash = next().to_string();
            let parents = next();
            let refs = next();
            let author = next().to_string();
            let date = next().to_string();
            let message = next().to_string();
            let body = next().trim().to_string();
            GitCommit {
                hash,
                parents: parents.split_whitespace().map(str::to_string).collect(),
                refs: parse_refs(refs),
                message,
                body,
                author,
                date,
            }
        })
        .collect()
}

/// Parses `git diff --name-status -z` output. Renames and copies carry two
/// paths (old, then new); every other status carries one.
pub fn parse_name_status(output: &str) -> Vec<CommitFile> {
    let parts: Vec<&str> = output.split('\0').filter(|part| !part.is_empty()).collect();
    let mut files = Vec::new();
    let mut i = 0;
    while i < parts.len() {
        let status = parts[i];
        let code = status.chars().next().map(String::from).unwrap_or_default();
        if status.starts_with('R') || status.starts_with('C') {
            files.push(CommitFile {
                code,
                old_path: parts.get(i + 1).map(|path| path.to_string()),
                path: parts.get(i + 2).copied().unwrap_or_default().to_string(),
            });
            i += 3;
        } else {
            files.push(CommitFile {
                code,
                old_path: None,
                path: parts.get(i + 1).copied().unwrap_or_default().to_string(),
            });
            i += 2;
        }
    }
    files
}

/// Parses `git status --porcelain=v1 -b -z` output.
///
/// A path with staged changes gets a staged entry (coded by the index letter),
/// and a path with working-tree changes gets an unstaged entry (coded by the
/// working-tree letter, "?" for untracked files). A partially staged path,
/// such as "MM", gets both.
pub fn parse_status(output: &str) -> GitStatus {
    let mut status = GitStatus {
        branch: None,
        ahead: 0,
        behind: 0,
        files: Vec::new(),
    };

    let mut entries = output.split('\0').filter(|entry| !entry.is_empty());
    while let Some(entry) = entries.next() {
        if let Some(header) = entry.strip_prefix("## ") {
            parse_branch_header(header, &mut status);
            continue;
        }
        let mut chars = entry.chars();
        let (Some(index), Some(work_tree)) = (chars.next(), chars.next()) else {
            continue;
        };
        let path = entry.get(3..).unwrap_or_default().to_string();
        // Renames and copies are followed by their original path; skip it.
        if matches!(index, 'R' | 'C') || matches!(work_tree, 'R' | 'C') {
            entries.next();
        }
        if index != ' ' && index != '?' {
            status.files.push(FileChange {
                path: path.clone(),
                staged: true,
                code: index.to_string(),
            });
        }
        if work_tree != ' ' {
            status.files.push(FileChange {
                path,
                staged: false,
                code: work_tree.to_string(),
            });
        }
    }
    status
}

/// Parses the "## ..." line of `git status -b`, for example
/// "main...origin/main [ahead 1, behind 2]", "No commits yet on main" or
/// "HEAD (no branch)".
fn parse_branch_header(header: &str, status: &mut GitStatus) {
    if header.starts_with("HEAD (no branch)") {
        return;
    }
    let header = header
        .strip_prefix("No commits yet on ")
        .or_else(|| header.strip_prefix("Initial commit on "))
        .unwrap_or(header);

    let (names, tracking) = match header.split_once(" [") {
        Some((names, tracking)) => (names, tracking.trim_end_matches(']')),
        None => (header, ""),
    };
    let branch = names.split_once("...").map_or(names, |(local, _)| local);
    status.branch = Some(branch.to_string());

    for part in tracking.split(", ") {
        if let Some(count) = part.strip_prefix("ahead ") {
            status.ahead = count.parse().unwrap_or(0);
        } else if let Some(count) = part.strip_prefix("behind ") {
            status.behind = count.parse().unwrap_or(0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_decorations() {
        let refs = parse_refs(
            "HEAD -> refs/heads/main, tag: refs/tags/v1, refs/remotes/origin/main, refs/remotes/origin/HEAD",
        );
        assert_eq!(
            refs,
            vec![
                GitRef { name: "main".into(), ref_type: RefType::Branch, current: Some(true) },
                GitRef { name: "v1".into(), ref_type: RefType::Tag, current: None },
                GitRef { name: "origin/main".into(), ref_type: RefType::Remote, current: None },
            ]
        );
        assert_eq!(parse_refs("HEAD")[0].ref_type, RefType::Head);
        assert!(parse_refs("").is_empty());
    }

    #[test]
    fn parses_log_records() {
        let output = "aaa\x1fbbb ccc\x1fHEAD -> refs/heads/main\x1fAda\x1f2024-01-01T00:00:00+00:00\x1fMerge\x1f\nBody text\n\x1e\n\
                      bbb\x1f\x1f\x1fAda\x1f2023-12-31T00:00:00+00:00\x1fRoot\x1f\x1e\n";
        let commits = parse_log(output);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].parents, vec!["bbb", "ccc"]);
        assert_eq!(commits[0].body, "Body text");
        assert_eq!(commits[0].refs[0].name, "main");
        assert_eq!(commits[1].hash, "bbb");
        assert!(commits[1].parents.is_empty());
        assert!(commits[1].refs.is_empty());
        assert_eq!(commits[1].message, "Root");
    }

    #[test]
    fn parses_name_status_with_renames() {
        let files = parse_name_status("M\0src/a.ts\0R100\0old.ts\0new.ts\0A\0b.ts\0");
        assert_eq!(files.len(), 3);
        assert_eq!(files[0].path, "src/a.ts");
        assert_eq!(files[1].code, "R");
        assert_eq!(files[1].old_path.as_deref(), Some("old.ts"));
        assert_eq!(files[1].path, "new.ts");
        assert_eq!(files[2].code, "A");
    }

    #[test]
    fn parses_status_entries() {
        let output = "## main...origin/main [ahead 2, behind 1]\0M  staged.ts\0 M unstaged.ts\0?? new file.ts\0R  renamed.ts\0original.ts\0MM both.ts\0";
        let status = parse_status(output);
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!((status.ahead, status.behind), (2, 1));
        let summary: Vec<(&str, bool, &str)> = status
            .files
            .iter()
            .map(|f| (f.path.as_str(), f.staged, f.code.as_str()))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("staged.ts", true, "M"),
                ("unstaged.ts", false, "M"),
                ("new file.ts", false, "?"),
                ("renamed.ts", true, "R"),
                ("both.ts", true, "M"),
                ("both.ts", false, "M"),
            ]
        );
    }

    #[test]
    fn parses_branch_headers() {
        assert_eq!(parse_status("## main\0").branch.as_deref(), Some("main"));
        assert_eq!(parse_status("## No commits yet on dev\0").branch.as_deref(), Some("dev"));
        assert_eq!(parse_status("## HEAD (no branch)\0").branch, None);
        let gone = parse_status("## main...origin/main [gone]\0");
        assert_eq!((gone.branch.as_deref(), gone.ahead, gone.behind), (Some("main"), 0, 0));
    }
}
