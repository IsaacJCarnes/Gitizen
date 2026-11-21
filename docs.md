# Gitizen

Gitizen is a desktop Git client built with Tauri (Rust backend) and a React + TypeScript UI.
The goal is feature parity with tools like GitHub Desktop and GitKraken.

## Features so far

### Repositories
- Open a local repository with a folder picker. Folders that aren't git repositories are rejected with an error.
- The repository name in the header reopens the picker to switch to another repository.
- Refresh button reloads status, history and branches.

### Branches
- Branch switcher in the header lists local branches and checks out the one you pick.
- Ahead/behind counts against the upstream branch are shown when non-zero.

### Working tree changes
- Sidebar shows every changed file in a single **Changes** list, each with its git status code (M, A, D, R, …) and a count of fully staged files.
- A file's status code stays the same whether it is staged or not: new files show **A** both untracked and staged.
- Opening a repository stages every changed file, so all checkboxes start ticked.
- Each file has a checkbox: ticking it stages the file, unticking unstages it. A partially staged file shows a mixed (dash) checkbox, and clicking it stages the rest.
- A checkbox in the list header stages every file at once, or unstages every file when all are already staged. It shows a mixed state when only some are staged.
- Files are sorted by path, so a file keeps its place in the list when it is staged or unstaged.
- Click a file to see its diff in the main panel: every uncommitted change against the last commit, staged and unstaged together, so the diff stays the same when the file is staged or unstaged. Untracked files show as entirely added. The file stays selected when it is staged or unstaged.

### Committing
- Commit message box with a button that commits the staged files (shows how many).
- The button is disabled until there is a message and at least one staged file.

### History
- Commit graph across all branches, remotes and tags (last 500 commits, stashes excluded), with coloured lanes for branches and merges.
- Ref badges show branches, remote branches and tags; the checked-out branch is bold.
- An **Uncommitted changes** row sits at the top of the graph, attached to HEAD with a dashed line, whenever the working tree has changes.
- Selecting a commit shows its subject, body, short hash, author and date in the sidebar, plus the files it changed (renames and copies included).
- Click a file in a commit to see its diff against the commit's first parent (so merges show what they brought in).

### Diffs
- Unified diff view with added, removed and hunk-header lines highlighted.
- Diff header shows the file path and where the change lives (commit hash, or Uncommitted), with a button back to the history.

### General
- Light and dark themes follow the operating system setting.
- Git errors are shown in an error bar instead of failing silently.

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
    git/
      runner.rs          Runs the git CLI (no shell, no console window)
      repository.rs      Holds the open repository; input validation and parent lookup
      parsers.rs         Pure functions that parse raw git output (unit tested)
      types.rs           Rust mirrors of shared/gitTypes.ts

src/                     UI (React)
  main.tsx, App.tsx      React entry point and root component
  api/gitizen.ts         Implements GitizenApi with Tauri invoke() calls
  styles/global.css      Theme variables and base element styles
  context/               React contexts: UI view state and git state
  hooks/useGitOperations.ts  All git state and actions for the app
  utils/                 Pure helpers: commit graph layout, formatting
  pages/GitizenView/     Top-level page layout
  components/
    common/              Reusable pieces: DiffView, FileListItem, TriStateCheckbox
    EmptyRepositoryView/ Start screen before a repository is open
    RepositoryHeader/    Top bar (repo, branch, sync, refresh)
    RepoSidebar/         Left sidebar: working-tree files, commit form, commit files
    RepoPanel/           Main panel: commit history graph and file diff
```

## Conventions
- Each component lives next to its own CSS file, grouped in a folder by the area of the screen it belongs to.
- Anything returned by the backend is typed in `shared/gitTypes.ts` and mirrored in `src-tauri/src/git/types.rs`. A new git operation gets a name in `Command` (`shared/ipc.ts`), a method in `GitizenApi`, a call in `src/api/gitizen.ts` (TypeScript checks it matches `GitizenApi`), and a `#[tauri::command]` in `src-tauri/src/commands.rs` registered in `lib.rs`.
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
