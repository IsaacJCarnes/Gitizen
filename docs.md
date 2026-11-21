# Gitizen

Gitizen is a desktop Git client built with Electron, React and TypeScript.
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
- Sidebar lists **Unstaged** and **Staged** files separately, each with its git status code (M, A, D, ?, …).
- Stage or unstage a single file with one click. The file stays selected as it moves between lists.
- Click a file to see its diff (staged or unstaged) in the main panel.

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
- Diff header shows the file path and where the change lives (commit hash, Staged or Unstaged), with a button back to the history.

### General
- Light and dark themes follow the operating system setting.
- Git errors are shown in an error bar instead of failing silently.

## Project structure

```
shared/                  Code used by both the Electron main process and the renderer
  gitTypes.ts            Data types sent over IPC (commits, status, refs, files)
  ipc.ts                 IPC channel names and the GitizenApi contract (window.gitizen)

electron/                Main process
  main.ts                App entry point: creates the window, registers IPC
  preload.ts             Exposes the typed GitizenApi to the renderer as window.gitizen
  git/
    handlers.ts          One IPC handler per git operation
    repository.ts        Holds the open repository; hash validation and parent lookup
    parsers.ts           Pure functions that parse raw git output

src/                     Renderer (React)
  main.tsx, App.tsx      React entry point and root component
  styles/global.css      Theme variables and base element styles
  types/window.d.ts      Declares window.gitizen for TypeScript
  context/               React contexts: UI view state and git state
  hooks/useGitOperations.ts  All git state and actions for the app
  utils/                 Pure helpers: commit graph layout, formatting
  pages/GitizenView/     Top-level page layout
  components/
    common/              Reusable pieces: DiffView, FileListItem
    EmptyRepositoryView/ Start screen before a repository is open
    RepositoryHeader/    Top bar (repo, branch, sync, refresh)
    RepoSidebar/         Left sidebar: working-tree files, commit form, commit files
    RepoPanel/           Main panel: commit history graph and file diff
```

## Conventions
- Each component lives next to its own CSS file, grouped in a folder by the area of the screen it belongs to.
- Anything sent over IPC is typed in `shared/gitTypes.ts`; new git operations get a channel in `shared/ipc.ts`, a handler in `electron/git/handlers.ts` and a method in `electron/preload.ts` (TypeScript checks that the preload matches `GitizenApi`).
- Parsing and layout logic is kept in pure functions (`electron/git/parsers.ts`, `src/utils/`) so it can be unit tested without Electron or React.

## Scripts
- `npm run dev`: start Vite and Electron in development mode
- `npm run build`: type-check, bundle and package with electron-builder
- `npm run lint`: ESLint with zero warnings allowed
