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
- Refresh button reloads status, history, branches, remotes, the branch's stash and any stopped operation.

### Remotes and syncing
- The header's sync buttons work like GitHub Desktop's:
  - **Publish repository** while the repository has no remote. It opens a modal that either creates the repository on GitHub with the GitHub CLI (`gh`, signed in with `gh auth login`; name, optional description, private or public), which adds it as `origin` and pushes the current branch, or adds an existing repository's URL as a remote.
  - **Publish branch** (beside **Fetch**) for a branch that isn't on the remote yet: pushes it to `origin` (or the only remote) and makes it track the remote branch.
  - Otherwise **Fetch**, **Pull ↓** and **Push ↑**, with how many commits Pull and Push would move. A non-zero count highlights the button.
- Fetch downloads from every remote and prunes remote branches deleted there. Pull merges the upstream into the branch unless `pull.rebase` is set; stopping on conflicts opens the conflict editor. Push pushes to the tracked branch and takes annotated tags on the pushed commits along.
- Pull and Push need a checked-out branch (not a detached HEAD). The button shows what is running ("Pulling…") and only one sync runs at a time.
- Network commands run off the main thread, so the window keeps answering. git never prompts in a terminal; credentials come from git's credential helper (Git Credential Manager's window on Windows).
- After amending or undoing a commit that was already pushed, Push becomes **Force push ↑**, which uses `--force-with-lease`: it is refused if someone else pushed since the last fetch.

### Branches
- The branch button in the header opens a list of local branches with a search box that filters them as you type. Click a branch (or press Enter on the first match) to check it out. Each branch shows how far it is ahead of (↑) and behind (↓) the checked-out branch. A new repository's unborn branch is listed too, and a detached HEAD shows as **Detached HEAD**.
- Right-click a branch in that list, or a branch's tip in the history, to **Rename** it (only the local branch; the name is checked with `git check-ref-format`) or **Delete** it. The checked-out branch can't be deleted. A branch with commits the current branch doesn't have says how many, and is deleted anyway (forced) once confirmed.
- In the history, a branch with commits the current branch lacks can also be brought into it:
  - **Merge … into …**: a merge commit, or a fast-forward when possible.
  - **Rebase … onto …**: replays the current branch's own commits on top of the other branch, keeping history in a line. Needs no uncommitted changes to tracked files.
  - **Squash and merge … into …**: asks for a summary and description, then adds every change of the other branch as one ordinary commit. The other branch stays as it is.
- Any of these that stops on conflicts opens the conflict editor (see Conflicts).

### Working tree changes
- Sidebar shows every changed file in a single **Changes** list, each with its git status code (M, A, D, R, …) and a count of fully staged files.
- A file's status code stays the same whether it is staged or not: new files show **A** both untracked and staged.
- Opening a repository leaves git's index as it is, so the checkboxes show exactly what was already staged.
- Each file has a checkbox: ticking it stages the file, unticking unstages it. A partially staged file shows a mixed (dash) checkbox, and clicking it stages the rest.
- A checkbox in the list header stages every file at once, or unstages every file when all are already staged. It shows a mixed state when only some are staged.
- A renamed file is staged and unstaged with both its old and new path, so the rename moves as one change. Paths git no longer has anywhere (e.g. the old half of a staged rename) are skipped instead of failing.
- Files are sorted by path, so a file keeps its place in the list when it is staged or unstaged.
- Click a file to see its diff in the main panel: every uncommitted change against the last commit, staged and unstaged together, so the diff stays the same when the file is staged or unstaged. Untracked files show as entirely added. The file stays selected when it is staged or unstaged.
- Right-click a file for **Discard changes…** and **Stash file** (or **Add file to stash**). Right-click the list header to stash every change.

### Discarding changes
- **Discard changes…** on a file puts it back the way it is in the last commit, staged and unstaged changes alike. A file the last commit doesn't have (untracked or newly added) is deleted, but only if git lists it as changed. Both paths of a rename are restored.
- **Discard all changes…** on the **Uncommitted changes** row in the history does the same for every changed file.
- In a working-tree diff, right-click an added or removed line for **Discard this line…**, or **Discard these N lines…** for its whole group of changes. The rest of the file keeps its changes, and a discarded line that was staged leaves the index too. Discarding every changed line is the same as discarding the file. This is off while whitespace is hidden, and refused if the file changed since its diff was shown.
- Discarding always asks first, since the changes aren't kept anywhere. Ticking **Don't warn me again until Gitizen is closed** skips the question until the app restarts (the choice is never saved).

### Editing files
- The diff header has an **Edit** button for a text file that is in the working directory, which opens it in an editor in the main panel. For an older commit's file the button reads **Edit in working directory**, since the current file is what changes.
- **Save** (or Ctrl+S / Cmd+S) writes the file with the line endings it already uses, after which its uncommitted diff is shown. **Cancel** leaves it as it was. Nothing is staged.
- Binary files, files over 5 MB, files inside `.git` and paths outside the repository can't be edited.

### Committing
- Commit form with a one-line **Summary** (required) and an optional multi-line **Description**, plus a button that commits the staged files (shows how many). The commit message is the summary, then a blank line and the description when there is one (git's subject and body). Both fields clear after a successful commit.
- The button is disabled until there is a summary and at least one staged file. Ctrl+Enter (Cmd+Enter on macOS) in either field commits.
- **AI commit messages**: the ✧ button on the description box pipes a prompt plus the staged diff to a command line tool you set up (for example `claude -p`) and fills the summary (first line) and description from what it prints. Nothing is staged or committed by it. The first click (or the ⚙ button beside it) asks for the command. It runs through the system shell (`cmd` on Windows, `sh` elsewhere) in the repository folder; very large diffs are cut short, code fences in the answer are dropped, and a command still running after 180 seconds is stopped (with everything it started, on Windows). The button is off while nothing is staged or an operation is stopped.

### History
- Commit graph across all branches, remotes and tags (last 500 commits, stashes excluded), with coloured lanes for branches and merges.
- The main branch (`main`, else `master`, else `origin/main` or `origin/master`) always runs down the first lane, following its first parents. Branches ahead of main get a lane of their own and join main's lane at the commit they branched from.
- Ref badges show branches, remote branches and tags; the checked-out branch is bold.
- An **Uncommitted changes** row sits at the top of the graph, attached to HEAD with a dashed line, whenever the working tree has changes. Right-click it to stash or discard every change.
- The branch's stash is a dashed node of its own, attached to the commit it was made on (see Stashing).
- Selecting a commit shows its subject, body, short hash, author and date in the sidebar, plus the files it changed (renames and copies included). The arrow beside the subject collapses the details to just the subject, and they stay collapsed while other commits are picked.
- Click a file in a commit to see its diff against the commit's first parent (so merges show what they brought in).

### Commit menu
Right-click any commit in the history for:
- **Checkout <branch>** for each local branch pointing at it, and **Checkout commit** to check out the commit itself (a detached HEAD).
- **Create branch from commit…** (optionally switching to it) and **Create tag…** (an annotated tag, so pushing the branch takes it along; the message defaults to the tag's name).
- **Cherry-pick to branch…**: copies the commit onto a local branch. Picking another branch switches to it first (and stays there), which needs no uncommitted changes to tracked files. Merge commits can't be cherry-picked here.
- The branch entries (rename, delete, merge, rebase, squash) of the branch at that commit; when several branches point at it, one submenu per branch.
- On the last commit of a branch, **Amend commit…** and **Undo commit**:
  - Amend fills the commit form with the commit's message and switches it to **Amend last commit**, so it can be reworded or have staged changes added. **Cancel** leaves amend mode.
  - Undo removes the commit but keeps its changes staged and puts its message back in the commit form (unless you are already writing one). Undoing the first commit leaves the branch with no commits; merge commits can't be undone.
  - On a branch that isn't checked out, Gitizen switches to it first. If you have uncommitted changes, it asks whether to commit them first or stash them and continue.
  - A commit that is already on the remote asks first, since the next push then has to be a force push.
- **Copy SHA**, and **View on GitHub** when a remote is on github.com (the tracked remote first, then `origin`, then any other). Only `https://github.com/` pages can be opened.

### Conflicts
- When a merge, squash merge, cherry-pick, rebase, revert, pull or stash operation stops on conflicts, Gitizen takes over instead of reporting an error, also when it finds one stopped on opening a repository.
- A banner above the changes says what is in progress (e.g. `side → main`), and how many conflicted files are left.
- Conflicted files are listed first with a **!** and a **Mark resolved** button, which stages the file as it is. If the file still has conflict markers, it asks first. Committing stays blocked until every file is resolved, and the commit form starts with git's prepared message (e.g. "Merge branch 'side'").
- The first conflicted file opens in the **conflict editor** in the main panel (click another to switch):
  - Each conflict shows the current branch's lines beside the incoming lines, each with a checkbox. Ticked lines go to the **Output** below, in the order they were ticked. **Take all current** and **Take all incoming** tick a whole side. Long stretches of unchanged lines are folded, with a button to show them.
  - The output can be edited by hand. **Save** writes it to the file with the file's own line endings, without staging it; **Mark resolved** then stages it.
  - **Resolve with AI** sends the file with its conflict markers to an AI command you set up (separate from the commit message command, so each can use its own tool or model) and puts the answer in the output for you to review and save. Answers that are empty or still have conflict markers are refused.
  - **Open in merge tool** opens the file in a command you set up (`{file}` stands for its path, e.g. `code {file}`), else in git's configured `merge.tool` (waiting until it closes; it stages the file itself when it succeeds), else in the system text editor. Changes made outside are picked up when Gitizen refreshes.
  - A binary file can only keep one whole side: **Keep current version** or **Use incoming version**.
- A merge, squash merge, cherry-pick or revert finishes with the commit button (**Commit merge** and so on) once every file is resolved. Beside it, **Abort Merge** (or **Abort Cherry-pick** and so on) puts everything back as it was before the operation started, after asking.
- A rebase shows **Rebase 2 out of 3** in the commit form, with **Continue rebase** and **Abort Rebase** instead of the commit button. Continuing keeps each commit's own message, drops a commit the resolution left empty, and may stop again on the next commit's conflicts.

### Stashing
- Each branch keeps one stash. **Stash all changes** (right-click **Uncommitted changes** or the Changes header) or **Stash file** (right-click a file) sets changes aside, untracked files included. When the branch already has a stash, the menus say **Add … to stash** and the new changes are combined with it into one stash.
- The stash shows in the history as a dashed **Stash** node beside the commit it was made on. Click it to list its files in the sidebar and see what it changes in each (read-only diffs), with **Pop stash** and **Discard stash** in place of the commit form. Right-clicking the node offers the same.
- **Pop stash** brings the changes back and removes the stash; it needs nothing staged. **Discard stash** deletes it for good, after the usual warning.
- If adding to the stash or popping it conflicts, a warning lists the files and offers to resolve them in the conflict editor or cancel, which puts the stash and your changes back exactly as they were. Once resolved, **Save stash** or **Finish popping stash** replaces the commit form, with **Abort Stash** or **Abort Stash Pop** beside it to cancel instead. A stopped stash operation is remembered in the git folder (`gitizen-stash.json`), so it can be finished or cancelled after a restart.
- Stashing, popping and discarding need a checked-out branch and nothing else in progress.

### Diffs
- Diff view with added, removed and hunk-header lines highlighted, and old and new line numbers.
- **Unified / Split** setting in the diff header: one column, or removed lines on the left beside the added lines that replace them on the right.
- **Hide whitespace** setting hides changes that only touch whitespace (`git diff -w`), for working-tree, commit and stash diffs. Both settings are saved between sessions (in the webview's localStorage, key `gitizen.diffSettings`).
- Diff header shows the file path and where the change lives (commit hash, Stash, or Uncommitted), with a button back to the history.
- git's file header (`diff --git`, `index`, `---`, `+++`) is hidden, since the diff header already names the file. Notes such as "new file mode" or "Binary files differ" still show.
- Each hunk starts with its header on one line, e.g. `@@ -8,6 +8,7 @@ import type {`: 6 old lines from line 8 become 7 new lines from line 8, followed by git's hint naming the nearest function or block above the hunk.
- Unchanged lines the diff leaves out can be expanded with one button per gap: **Expand up** above the first hunk, **Expand down** below the last, and **Expand** between two hunks (20 more lines on each side per click). The row says how many lines are still hidden. Works for working-tree and commit diffs, in both layouts.
- Stage single lines: a working-tree diff shows every uncommitted change, and each added and removed line has a checkbox that is ticked when that line is staged. Tick a line to stage it, untick it to unstage it; the diff text itself never changes. Each group of changed lines (a run of added and removed lines with no unchanged line between them, even a single line) also has a checkbox in its own column, left of the lines in Unified and between the two sides in Split. It stages or unstages the whole group and shows a dash when only part of it is staged. Works in both layouts, and for new, untracked and deleted files: unstaging every line of a new file makes it untracked again, and staging every line of a deleted file stages the deletion.
- Line staging is off while whitespace is hidden, because the index is rebuilt from the full diff. If the file changed since its diff was shown, the change is refused instead of hitting the wrong lines.

### General
- Light and dark themes follow the operating system setting. Every colour lives in `src/styles/theme.css` as a CSS variable, so a theme only overrides those (setting `data-theme="light"` or `"dark"` on `<html>` forces one).
- Git errors pop up in a modal with git's message instead of failing silently. The modal stays until dismissed (OK, Escape or a click outside), and offers an action when one can fix the problem.
- Right-click menus close on a click outside, Escape, scrolling or the window losing focus, and stay inside the window. Items with a submenu open it on hover, click or the right arrow key.
- The commands set up for AI commit messages, AI conflict resolving and the external merge tool are saved in `settings.json` in the app's config folder.

## Project structure

```
shared/                  Types shared by the UI and mirrored by the Rust backend
  gitTypes.ts            Data types returned by git commands (commits, status, refs, files, conflicts, stash)
  ipc.ts                 Tauri command names and the GitizenApi contract

src-tauri/               Rust backend (Tauri 2)
  tauri.conf.json        Window, dev server and bundle settings
  capabilities/          Permissions granted to the window
  icons/                 App icons, generated from app-icon.png with `npm run tauri icon`
  src/
    main.rs, lib.rs      App entry point: builds the window, registers commands
    commands.rs          Core git commands: open, status, log, branches, diffs, staging, commit, undo, checkout
    branches.rs          Rename, delete, merge, rebase onto and squash merge local branches
    commit_actions.rs    Commit menu actions: checkout commit, create branch or tag, cherry-pick, open on GitHub
    remote.rs            Remotes, publishing with the GitHub CLI, fetch, pull and push
    conflicts.rs         Stopped operations and conflicted files: conflict editor data, resolve, continue, abort, AI resolve, merge tool
    stash.rs             One stash per branch: stash, add to it, pop, drop, and their conflicts
    discard.rs           Discarding files and single lines
    edit_file.rs         Reading and saving working-tree files for the in-app editor
    ai_commit.rs         AI commit messages, and running a user's shell command with a timeout
    settings.rs          settings.json: the saved AI and merge tool commands
    recent_repos.rs      Saved list of recently opened repositories, and its commands
    util.rs              Shared helpers: config files, blocking threads, temp folders, safe paths, test repositories
    git/
      runner.rs          Runs the git CLI (no shell, no console window, never prompts)
      repository.rs      Holds the open repository (and `git init`); input validation, branch and git-folder helpers
      parsers.rs         Pure functions that parse raw git output (unit tested)
      patch.rs           Works out which diff lines are staged and builds index content for line staging (unit tested)
      types.rs           Rust mirrors of shared/gitTypes.ts

src/                     UI (React)
  main.tsx, App.tsx      React entry point and root component
  api/gitizen.ts         Implements GitizenApi with Tauri invoke() calls
  styles/theme.css       Theme variables: every colour, plus shared fonts, radii and shadows (light and dark)
  styles/global.css      Base element styles and shared classes (.popover, .button-group, .spinner, .hint)
  context/               React contexts: UI state (view, recent repositories, discard warning) and git state
  hooks/
    useGitOperations.ts  All git state and actions for the app
    useDiffSettings.ts   Diff layout and whitespace settings, saved in localStorage
    useSavedCommand.ts   Loads and saves one of the commands kept in settings.json
    useContextMenu.ts    Open/close state of a right-click menu
  utils/                 Pure helpers: commit graph layout, diff line parsing, conflict text, GitHub links,
                         tri-state checkbox logic, formatting, loading in effects, error normalising
  pages/GitizenView/     Top-level page layout
  components/
    common/              Reusable pieces: DiffView, FileListItem, TriStateCheckbox, ContextMenu, and the
                         modals (ActionModal, ConfirmModal, FormModal, CommandModal, DiscardConfirm)
    Branches/            Branch menu entries and the rename, delete and squash dialogs
    Conflicts/           Conflict banner, conflict editor, Mark resolved and Abort buttons
    Stash/               Stash file list, Pop/Discard, finish button, conflict warning, shared stash menu items
    EmptyRepositoryView/ Start screen before a repository is open
    ErrorModal/          Pops up failed operations; offers git init for non-repositories
    RepositoryHeader/    Top bar: repo switcher, branch switcher, sync controls and publish modal, refresh
    RepoSidebar/         Left sidebar: working-tree files, commit form, commit files
    RepoPanel/           Main panel: commit history graph, commit menu and its dialogs, file diff and editor
```

## Conventions
- Each component lives next to its own CSS file, grouped in a folder by the area of the screen it belongs to.
- CSS never names a colour directly: it reads the variables in `src/styles/theme.css` (add one there if nothing fits), and reuses the shared classes in `global.css` (`.popover`, `.button-group`, `.spinner`, `.hint`, and `.modal-form` in ActionModal.css) instead of restyling them.
- Anything returned by the backend is typed in `shared/gitTypes.ts` and mirrored in `src-tauri/src/git/types.rs` (or next to the command in its module). A new git operation gets a name in `Command` (`shared/ipc.ts`), a method in `GitizenApi`, a call in `src/api/gitizen.ts` (TypeScript checks it matches `GitizenApi`), and a `#[tauri::command]` in one of the backend modules, registered in `lib.rs`.
- A backend command is a thin `async` wrapper that gets the open repository and calls a plain `*_in(dir, …)` function, which is what the Rust tests call. Slow commands (network, AI, an external merge tool) run through `util::blocking` so other commands keep answering.
- Commands reject with git's message as a plain string. The exception is opening a repository, which rejects with an `OpenRepositoryError` object (`{ kind: "notARepository", path, message }` or `{ kind: "failed", message }`, `OpenError` in Rust) so the UI can offer to create one. `useGitOperations` normalises every failure into that shape for the error modal.
- Actions in `useGitOperations` resolve to true or false and never reject: on failure the error modal already shows git's message. Each one refreshes the git state after it runs.
- Operations that can stop on conflicts (merge, pull, cherry-pick, rebase, continue, stash) treat stopping with unmerged files as success, and the conflict editor takes over.
- Tauri maps camelCase argument names from the UI to snake_case Rust parameters (`oldPath` becomes `old_path`).
- Parsing logic is kept in pure functions (`src-tauri/src/git/parsers.rs`, `src/utils/`) so it can be unit tested without Tauri or React.
- Git is run through the git CLI, so it must be installed and on PATH. Publishing to GitHub also needs the GitHub CLI (`gh`).

## Requirements
- Node.js, Git, and the Rust toolchain (rustup) with the Microsoft C++ Build Tools on Windows. See https://v2.tauri.app/start/prerequisites/.
- Optional: the GitHub CLI (`gh`) for **Publish repository**, and any command line AI tool that reads stdin (e.g. `claude -p`) for AI commit messages and conflict resolving.

## Scripts
- `npm run app:dev`: start Vite and the Tauri app in development mode
- `npm run app:build`: type-check, bundle and package an installer with Tauri
- `npm run dev` / `npm run build`: the UI alone (Tauri runs these itself)
- `npm run lint`: ESLint with zero warnings allowed
- `cargo test --manifest-path src-tauri/Cargo.toml`: Rust unit tests
