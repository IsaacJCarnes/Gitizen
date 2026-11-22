# Gitizen

Gitizen is a desktop Git client built with Tauri (Rust backend) and a React + TypeScript UI.
The goal is feature parity with tools like GitHub Desktop and GitKraken.

## Features so far

### Repositories
- Open a local repository with a folder picker.
- Picking a folder (or a recent repository) that isn't a git repository pops up a modal offering **Create repository**, which runs `git init` in that folder and opens it. Folders already inside a repository are never re-initialised.
- Every repository that opens successfully is saved to a recent list (most recent first, up to 15), kept in `recent-repositories.json` in the app's config folder so it survives restarts.
- The repository name in the header opens a dropdown of recent repositories: click one to switch to it, or hover and click × to remove it from the list. **Add new repo…** at the bottom opens the folder picker.
- The start screen lists recent repositories under **Open repository** so you can reopen one with a click.
- Refresh button reloads status, history and branches.

### Branches
- Branch switcher in the header lists local branches and checks out the one you pick.
- Ahead/behind counts against the upstream branch are shown when non-zero.

### Working tree changes
- Sidebar shows every changed file in a single **Changes** list, each with its git status code (M, A, D, R, …) and a count of fully staged files.
- A file's status code stays the same whether it is staged or not: new files show **A** both untracked and staged.
- Opening a repository leaves git's index as it is, so the checkboxes show exactly what was already staged.
- Each file has a checkbox: ticking it stages the file, unticking unstages it. A partially staged file shows a mixed (dash) checkbox, and clicking it stages the rest.
- A checkbox in the list header stages every file at once, or unstages every file when all are already staged. It shows a mixed state when only some are staged.
- Files are sorted by path, so a file keeps its place in the list when it is staged or unstaged.
- Click a file to see its diff in the main panel: every uncommitted change against the last commit, staged and unstaged together, so the diff stays the same when the file is staged or unstaged. Untracked files show as entirely added. The file stays selected when it is staged or unstaged.

### Committing
- Commit form with a one-line **Summary** (required) and an optional multi-line **Description**, plus a button that commits the staged files (shows how many). The commit message is the summary, then a blank line and the description when there is one (git's subject and body). Both fields clear after a successful commit.
- The button is disabled until there is a summary and at least one staged file. Ctrl+Enter (Cmd+Enter on macOS) in either field commits.

### History
- Commit graph across all branches, remotes and tags (last 500 commits, stashes excluded), with coloured lanes for branches and merges.
- The main branch (`main`, else `master`, else `origin/main` or `origin/master`) always runs down the first lane, following its first parents. Branches ahead of main get a lane of their own and join main's lane at the commit they branched from.
- Ref badges show branches, remote branches and tags; the checked-out branch is bold.
- An **Uncommitted changes** row sits at the top of the graph, attached to HEAD with a dashed line, whenever the working tree has changes.
- Selecting a commit shows its subject, body, short hash, author and date in the sidebar, plus the files it changed (renames and copies included).
- Click a file in a commit to see its diff against the commit's first parent (so merges show what they brought in).

### Diffs
- Diff view with added, removed and hunk-header lines highlighted, and old and new line numbers.
- **Unified / Split** setting in the diff header: one column, or removed lines on the left beside the added lines that replace them on the right.
- **Hide whitespace** setting hides changes that only touch whitespace (`git diff -w`), for working-tree and commit diffs. Both settings are saved between sessions (in the webview's localStorage, key `gitizen.diffSettings`).
- Diff header shows the file path and where the change lives (commit hash, or Uncommitted), with a button back to the history.
- git's file header (`diff --git`, `index`, `---`, `+++`) is hidden, since the diff header already names the file. Notes such as "new file mode" or "Binary files differ" still show.
- Each hunk starts with its header on one line, e.g. `@@ -8,6 +8,7 @@ import type {`: 6 old lines from line 8 become 7 new lines from line 8, followed by git's hint naming the nearest function or block above the hunk.
- Unchanged lines the diff leaves out can be expanded with one button per gap: **Expand up** above the first hunk, **Expand down** below the last, and **Expand** between two hunks (20 more lines on each side per click). The row says how many lines are still hidden. Works for working-tree and commit diffs, in both layouts.
- Stage single lines: a working-tree diff shows every uncommitted change, and each added and removed line has a checkbox that is ticked when that line is staged. Tick a line to stage it, untick it to unstage it; the diff text itself never changes. Each group of changed lines (a run of added and removed lines with no unchanged line between them, even a single line) also has a checkbox in its own column, left of the lines in Unified and between the two sides in Split. It stages or unstages the whole group and shows a dash when only part of it is staged. Works in both layouts, and for new, untracked and deleted files: unstaging every line of a new file makes it untracked again, and staging every line of a deleted file stages the deletion.
- Line staging is off while whitespace is hidden, because the index is rebuilt from the full diff. If the file changed since its diff was shown, the change is refused instead of hitting the wrong lines.

### General
- Light and dark themes follow the operating system setting.
- Git errors pop up in a modal with git's message instead of failing silently. The modal stays until dismissed (OK, Escape or a click outside), and offers an action when one can fix the problem.

## Project structure

```
shared/                  Types shared by the UI and mirrored by the Rust backend
  gitTypes.ts            Data types returned by git commands (commits, status, refs, files)
  ipc.ts                 Tauri command names and the GitizenApi contract

src-tauri/               Rust backend (Tauri 2)
  tauri.conf.json        Window, dev server and bundle settings
  capabilities/          Permissions granted to the window
  icons/                 App icons, generated from app-icon.svg with `npm run tauri icon`
  src/
    main.rs, lib.rs      App entry point: builds the window, registers commands
    commands.rs          One Tauri command per git operation
    recent_repos.rs      Saved list of recently opened repositories, and its commands
    git/
      runner.rs          Runs the git CLI (no shell, no console window)
      repository.rs      Holds the open repository (and `git init`); input validation and parent lookup
      parsers.rs         Pure functions that parse raw git output (unit tested)
      patch.rs           Works out which diff lines are staged and builds index content for line staging (unit tested)
      types.rs           Rust mirrors of shared/gitTypes.ts

src/                     UI (React)
  main.tsx, App.tsx      React entry point and root component
  api/gitizen.ts         Implements GitizenApi with Tauri invoke() calls
  styles/global.css      Theme variables and base element styles
  context/               React contexts: UI state (view, recent repositories) and git state
  hooks/useGitOperations.ts  All git state and actions for the app
  hooks/useDiffSettings.ts   Diff layout and whitespace settings, saved in localStorage
  utils/                 Pure helpers: commit graph layout, diff line parsing, tri-state checkbox logic, formatting, error normalising
  pages/GitizenView/     Top-level page layout
  components/
    common/              Reusable pieces: DiffView, FileListItem, TriStateCheckbox, ActionModal
    EmptyRepositoryView/ Start screen before a repository is open
    ErrorModal/          Pops up failed operations; offers git init for non-repositories
    RepositoryHeader/    Top bar (repo switcher dropdown, branch, sync, refresh)
    RepoSidebar/         Left sidebar: working-tree files, commit form, commit files
    RepoPanel/           Main panel: commit history graph and file diff
```

## Conventions
- Each component lives next to its own CSS file, grouped in a folder by the area of the screen it belongs to.
- Anything returned by the backend is typed in `shared/gitTypes.ts` and mirrored in `src-tauri/src/git/types.rs`. A new git operation gets a name in `Command` (`shared/ipc.ts`), a method in `GitizenApi`, a call in `src/api/gitizen.ts` (TypeScript checks it matches `GitizenApi`), and a `#[tauri::command]` in `src-tauri/src/commands.rs` registered in `lib.rs`.
- Commands reject with git's message as a plain string. The exception is opening a repository, which rejects with an `OpenRepositoryError` object (`{ kind: "notARepository", path, message }` or `{ kind: "failed", message }`, `OpenError` in Rust) so the UI can offer to create one. `useGitOperations` normalises every failure into that shape for the error modal.
- Tauri maps camelCase argument names from the UI to snake_case Rust parameters (`oldPath` becomes `old_path`).
- Parsing logic is kept in pure functions (`src-tauri/src/git/parsers.rs`, `src/utils/`) so it can be unit tested without Tauri or React.
- Git is run through the git CLI, so it must be installed and on PATH.

## Requirements
- Node.js, Git, and the Rust toolchain (rustup) with the Microsoft C++ Build Tools on Windows. See https://v2.tauri.app/start/prerequisites/.

## Scripts
- `npm run app:dev`: start Vite and the Tauri app in development mode
- `npm run app:build`: type-check, bundle and package an installer with Tauri
- `npm run dev` / `npm run build`: the UI alone (Tauri runs these itself)
- `npm run lint`: ESLint with zero warnings allowed
- `cargo test --manifest-path src-tauri/Cargo.toml`: Rust unit tests
