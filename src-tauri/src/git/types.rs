//! Data shapes sent to the UI. They mirror `shared/gitTypes.ts` field for
//! field; serde renames fields so the JSON matches the TypeScript exactly.

use serde::Serialize;

/// A file with uncommitted changes in the working tree or index.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// Previous path, set for renames ("R") and copies ("C").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    /// True when the change is in the index (staged), false for the working tree.
    pub staged: bool,
    /// Single-letter git status code, e.g. "M", "A", "D", "R" or "?".
    pub code: String,
}

/// The combined diff of one working-tree file (HEAD to working tree) and
/// which of its changed lines are staged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub diff: String,
    /// Indices into `diff.split('\n')` of the added and removed lines that
    /// are in the index.
    pub staged_lines: Vec<usize>,
}

/// Snapshot of `git status` for the open repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GitStatus {
    /// Current branch name, or None (null) when HEAD is detached.
    pub branch: Option<String>,
    /// The branch it tracks, e.g. "origin/main"; omitted when it tracks none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<FileChange>,
}

/// What kind of ref a `GitRef` is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RefType {
    Branch,
    Remote,
    Tag,
    Head,
}

/// A ref (branch, remote branch, tag or detached HEAD) pointing at a commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GitRef {
    pub name: String,
    #[serde(rename = "type")]
    pub ref_type: RefType,
    /// True for the ref HEAD currently points at; omitted otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<bool>,
}

/// One commit from `git log`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GitCommit {
    pub hash: String,
    /// Parent hashes; the first one is the first parent. Empty for root commits.
    pub parents: Vec<String>,
    pub refs: Vec<GitRef>,
    /// Commit subject (first line of the message).
    pub message: String,
    /// Rest of the commit message after the subject, trimmed.
    pub body: String,
    pub author: String,
    /// Author date in ISO 8601 format.
    pub date: String,
}

/// A local branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
    /// Commits on this branch that the checked-out commit (HEAD) doesn't have.
    pub ahead: u32,
    /// Commits HEAD has that this branch doesn't.
    pub behind: u32,
}

/// A file changed by a commit, relative to its first parent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub path: String,
    /// Previous path, set for renames ("R") and copies ("C").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    /// Single-letter git status code, e.g. "M", "A", "D", "R" or "C".
    pub code: String,
}
