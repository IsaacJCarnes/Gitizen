# Gitizen

Gitizen is a desktop Git client built with Tauri (Rust backend) and a React + TypeScript UI.
The goal is feature parity with tools like GitHub Desktop and GitKraken.

## Features so far

### Repositories
- Open a local repository with a folder picker.
- Picking a folder (or a recent repository) that isn't a git repository pops up a modal offering **Create repository**, which runs `git init` in that folder and opens it. Folders already inside a repository are never re-initialised.
- Every repository that opens successfully is saved to a recent list (most recent first, up to 15), kept in `recent-repositories.json` in the app's config folder so it survives restarts.
- The repository name in the header opens a dropdown of recent repositories: click one to switch to it, or hover and click × to remove it from the list. Removing the open repository closes it and goes back to the start screen. **Add local repo...** at the bottom opens the folder picker, and **Clone repo...** opens the clone modal.
- If the open repository's folder is deleted (or stops being a repository), Gitizen closes it at the next refresh and says so.
- The start screen lists recent repositories under **Open repository** so you can reopen one with a click.
- **Clone repository** (on the start screen, and **Clone repo...** in the repository dropdown) clones into a new folder and opens it. Pick the repository from your GitHub repositories (yours, collaborations and your organizations', most recently updated first, with a filter box; needs the GitHub sign-in), or paste any URL. Choose the folder to clone into (**Browse…**, remembered for next time) and the new folder's name, which follows the repository's name until you type your own. A folder that already exists must be empty. Private repositories sign in through git's credential helper like any other git command.
- No refresh button: Gitizen watches the repository's files and refreshes by itself (status, history, branches, remotes, the branch's stash, any stopped operation and the open diff) a moment after anything changes, whether in Gitizen, an editor, a terminal or another git tool, even while its window isn't focused. Bursts of changes are gathered into one refresh. Changes to files `.gitignore` ignores (build output, `node_modules`) and git's own object store and lock files are left out. Coming back to the window refreshes too.
- Each refresh is one backend call (`repository_state`) that runs its git commands side by side and shares what several parts need (one `git status` gives the changes, the branch, the conflicted files and whether there are commits yet). A Gitizen action refreshes once when it finishes: the watcher's report of the changes it made is skipped, since that refresh already shows them.

### GitHub account
- **Sign in to GitHub** in the header (and on the start screen) signs in through git's credential helper: Git Credential Manager, which comes with Git for Windows, opens GitHub's sign-in in the browser. Without it, paste a personal access token instead (a classic token needs the `repo` scope). Either way the sign-in is checked with GitHub and saved in the credential helper, so git's own pushes and pulls to github.com use it too, and Gitizen picks it up again at the next start.
- Signed in, the button shows your avatar and login; its menu opens your profile or signs out. Signing out removes the sign-in from the credential helper as well, so git asks again next time.
- The token never reaches the UI: the backend asks the credential helper for it and calls GitHub's REST API itself.

### Remotes and syncing
- The header's sync buttons work like GitHub Desktop's:
  - **Publish repository** while the repository has no remote. It opens a modal that either creates the repository on the signed-in GitHub account (name, optional description, private or public; see GitHub account), which adds it as `origin` and pushes the current branch, or adds an existing repository's URL as a remote. There is no **Fetch** button while there is no remote.
  - Creating the repository from a branch other than `main` (or `master`) shows a warning in that modal, since only that branch is pushed and it becomes the repository's default branch. **Publish branch** to a remote that has no branches yet asks the same, offering to switch to main first.
  - With several remotes and none named `origin`, **Connect origin** replaces **Publish branch** and opens the modal on adding an existing remote.
  - **Publish branch** (beside **Fetch**) for a branch that isn't on the remote yet: pushes it to `origin` (or the only remote) and makes it track the remote branch.
  - Otherwise **Fetch**, **Pull ↓** and **Push ↑**, with how many commits Pull and Push would move. A non-zero count highlights the button.
- Gitizen also fetches by itself in the background: when a repository with remotes opens, then every 5 minutes, and when you come back to the window once that much time has passed. The Pull and Push counts and each branch's ahead/behind stay current without clicking Fetch. A background fetch never pops up a sign-in window (it passes `credential.interactive=never` to Git Credential Manager); if it can't sign in or reach the remote it quietly tries again next round. It never runs at the same time as a fetch, pull or push you start. The Fetch button's tooltip says when the last fetch was.
- Fetch downloads from every remote and prunes remote branches deleted there. Pull merges the upstream into the branch unless `pull.rebase` is set; stopping on conflicts opens the conflict editor. Push pushes to the tracked branch and takes annotated tags on the pushed commits along.
- Pull and Push need a checked-out branch (not a detached HEAD). The button shows what is running ("Pulling…") and only one sync runs at a time.
- Network commands run off the main thread, so the window keeps answering. git never prompts in a terminal; credentials come from git's credential helper (Git Credential Manager's window on Windows).
- After amending or undoing a commit that was already pushed, Push becomes **Force push ↑**, which uses `--force-with-lease`: it is refused if someone else pushed since the last fetch.

### Branches
- The branch button in the header opens a list of local branches with a search box that filters them as you type. Click a branch (or press Enter on the first match) to check it out. Each branch shows how far it is ahead of (↑) and behind (↓) the checked-out branch. A new repository's unborn branch is listed too, and a detached HEAD shows as **Detached HEAD**.
- Switching branches (from that list or a commit's menu) with uncommitted changes first asks what to do with them, like GitHub Desktop: **Leave on <branch>** stashes them (untracked files too) in that branch's stash, to pop when you come back, or **Bring to <branch>** carries them over. When the other branch changes some of the same files, the changes go over through a stash that is applied there and dropped; if they change the same lines, it stops on conflicts for the conflict editor, like popping a stash. Resolving keeps the merged changes on the new branch; cancelling leaves you there with a clean tree and your changes kept as the old branch's stash. Leaving them on a branch that already has a stash adds them to it, which may stop on conflicts like any stash (see Stashing); then the switch doesn't happen.
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
- Commit form with a one-line **Summary** (required) and an optional multi-line **Description**, plus a button that commits the staged files (shows how many). The commit message is the summary, then a blank line and the description when there is one (git's subject and body). Both fields clear after a successful commit, and once nothing is left to commit the main panel goes back to the history.
- Each repository keeps its own unfinished summary and description (saved in localStorage, key `gitizen.commitDrafts`), so switching repositories and back brings the message back.
- The button is disabled until there is a summary and at least one staged file. Ctrl+Enter (Cmd+Enter on macOS) in either field commits.
- **AI commit messages**: the ✧ button on the description box pipes a prompt plus the staged diff to a command line tool you set up (for example `claude -p`) and fills the summary (first line) and description from what it prints. Nothing is staged or committed by it. The first click (or the ⚙ button beside it) asks for the command. It runs through the system shell (`cmd` on Windows, `sh` elsewhere) in the repository folder; very large diffs are cut short, code fences in the answer are dropped, and a command still running after 180 seconds is stopped (with everything it started, on Windows). The button is off while nothing is staged or an operation is stopped.

### History
- Commit graph across all branches, remotes and tags (last 500 commits, stashes excluded), with coloured lanes for branches and merges.
- The main branch (`main`, else `master`, else `origin/main` or `origin/master`) always runs down the first lane, following its first parents. Branches ahead of main get a lane of their own and join main's lane at the commit they branched from.
- Ref badges show branches, remote branches and tags; the checked-out branch is bold.
- An **Uncommitted changes** row sits at the top of the graph, attached to HEAD with a dashed line, whenever the working tree has changes. Right-click it to stash or discard every change.
- Every branch's stash is a dashed node of its own, just above the commit it was made on, also for branches that aren't checked out (labelled **Stash on <branch>**). If that commit is no longer on the branch (undone or amended), the stash attaches to the branch's tip instead, so it stays with its branch (see Stashing). It sits in that commit's lane; when the **Uncommitted changes** row takes the lane, the stash moves to a lane beside it but keeps the commit's colour.
- Orphan branches (histories with a first commit of their own, sharing nothing with main) get the lanes furthest right.
- Double-click a local branch's badge to check that branch out.
- Selecting a commit shows its subject, body, short hash, author and date in the sidebar, plus the files it changed (renames and copies included). The arrow beside the subject collapses the details to just the subject, and they stay collapsed while other commits are picked.
- Click a file in a commit to see its diff against the commit's first parent (so merges show what they brought in).
- Select several commits with **Ctrl+click** (add or remove one) or **Shift+click** (every commit between the last one clicked and this one: when one of them descends from the other, only the commits on the line between them, leaving out commits other branches made meanwhile; otherwise every row between them). The sidebar then says how many are selected and lists them, and the files and diffs show all of their changes together: from before the oldest selected commit through the newest, like one big commit. Commits in between that aren't selected are included too (the sidebar says how many). The diff header shows the range, e.g. `0808080 … 1010101`. Selections drop commits that a refresh no longer finds (after an amend, say).

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
- **Revert commit**: adds a commit to the current branch that undoes this one (a merge is undone against its first parent). Needs no uncommitted changes to tracked files; conflicts open the conflict editor.
- **Reset <branch> to this commit** (on an earlier commit of the current branch's line), with a submenu: **Soft** keeps the changes of the commits after it staged, **Mixed** keeps them unstaged, **Hard** throws them away along with any uncommitted changes. A confirmation says how many commits leave the branch, which of them are on no other branch, tag or remote (they drop out of the history), and that ones the remote has come back with Pull. Only the checked-out branch moves.
- For each tag on the commit, a **Tag <name>** submenu: **Push tag** pushes it to `origin` (or the only remote), **Delete tag…** deletes it, and from the remote too if you tick that.
- With several commits selected, right-clicking one of them adds **Squash N commits…** at the top: it asks for the message (starting from the oldest commit's subject, the others' subjects listed below) and makes them one commit with all of their changes and the oldest one's author. Later commits are replayed on top.
- **Copy SHA**, and **View on GitHub** when a remote is on github.com (the tracked remote first, then `origin`, then any other). Only `https://github.com/` pages can be opened.

### Rewriting safely
- Squashing only rewrites the checked-out branch's own commits: from its tip back to the first merge, or the first commit that another branch, a tag or a remote branch also has. Rewriting those changes nothing anyone else can see, so other branches, tags and the remote never end up pointing at history that was replaced. For other commits the squash item is off and says why. It needs no uncommitted changes to tracked files.

### Conflicts
- When a merge, squash merge, cherry-pick, rebase, revert, pull or stash operation stops on conflicts, Gitizen takes over instead of reporting an error, also when it finds one stopped on opening a repository.
- A banner above the changes says what is in progress (e.g. `side → main`), and how many conflicted files are left.
- Conflicted files are listed first with a **!** and a **Mark resolved** button, which stages the file as it is. If the file still has conflict markers, it asks first. Committing stays blocked until every file is resolved, and the commit form starts with git's prepared message (e.g. "Merge branch 'side'").
- The first conflicted file opens in the **conflict editor** in the main panel (click another to switch):
  - Each conflict shows the current branch's lines beside the incoming lines, each with a checkbox. Ticked lines go to the **Output** below, in the order they were ticked. **Take all current** and **Take all incoming** tick a whole side. Long stretches of unchanged lines are folded, with a button to show them.
  - The output can be edited by hand. **Save** writes it to the file with the file's own line endings. When no conflict markers are left, saving also marks the file resolved (stages it) and opens the next conflicted file; otherwise **Mark resolved** stages it.
  - **Resolve with AI** sends the file with its conflict markers to an AI command you set up (separate from the commit message command, so each can use its own tool or model) and puts the answer in the output for you to review and save. Answers that are empty or still have conflict markers are refused.
  - **Open in merge tool** opens the file in a command you set up (`{file}` stands for its path, e.g. `code {file}`), else in git's configured `merge.tool` (waiting until it closes; it stages the file itself when it succeeds), else in the system text editor. Changes made outside are picked up when Gitizen refreshes.
  - A binary file can only keep one whole side: **Keep current version** or **Use incoming version**.
- A merge, squash merge, cherry-pick or revert finishes with the commit button (**Commit merge** and so on) once every file is resolved. Beside it, **Abort Merge** (or **Abort Cherry-pick** and so on) puts everything back as it was before the operation started, after asking.
- A rebase shows **Rebase 2 out of 3** in the commit form, with **Continue rebase** and **Abort Rebase** instead of the commit button. Continuing keeps each commit's own message, drops a commit the resolution left empty, and may stop again on the next commit's conflicts.

### Stashing
- Each branch keeps one stash. **Stash all changes** (right-click **Uncommitted changes** or the Changes header) or **Stash file** (right-click a file) sets changes aside, untracked files included. When the branch already has a stash, the menus say **Add … to stash** and the new changes are combined with it into one stash.
- The stash shows in the history as a dashed **Stash** node beside the commit it was made on. Click it to list its files in the sidebar and see what it changes in each (read-only diffs), with **Pop stash** and **Discard stash** in place of the commit form. Right-clicking the node offers the same. Another branch's stash offers **Switch to <branch> and pop** instead, and can be discarded without switching.
- Popping over uncommitted changes to the same files sets those changes aside, pops the stash, then merges the changes back in. Where they change the same lines as the stash, the conflict editor opens (the stash on one side, your changes on the other); cancelling puts the stash and your changes back as they were.
- **Pop stash** brings the changes back and removes the stash; it needs nothing staged. **Discard stash** deletes it for good, after the usual warning.
- If adding to the stash or popping it conflicts, a warning lists the files and offers to resolve them in the conflict editor or cancel, which puts the stash and your changes back exactly as they were. Once resolved, **Save stash** or **Finish popping stash** replaces the commit form, with **Abort Stash** or **Abort Stash Pop** beside it to cancel instead. A stopped stash operation is remembered in the git folder (`gitizen-stash.json`), so it can be finished or cancelled after a restart.
- Stashing, popping and discarding need a checked-out branch and nothing else in progress.

### Diffs
- Diff view with added, removed and hunk-header lines highlighted, and old and new line numbers.
- Each run of changes is a hunk of its own. Where git's hunk has unchanged lines between two runs of changes, it is split there, and those lines fold into an **Expand** row like the space between hunks (the context git shows before the first change and after the last stays). Each piece gets its own `@@` header; the first keeps git's hint naming the enclosing function or block.
- A line that a run of changes removes and adds back unchanged (git's diff sometimes does this, e.g. with a `}` between two edits) is shown as an unchanged line instead, so it isn't counted as a change or staged with its neighbours. Runs too big to match up (over 250,000 removed × added lines, like a rewritten file) are shown as git wrote them.
- The same goes for a file's last line that had no line break when lines are added after it: git shows it removed and added back (it gained a line break), but it is shown unchanged, since the lines after it need that line break anyway. A line whose only change is gaining or losing its line break, with nothing added after it, still shows as a change with git's "No newline at end of file" note.
- **Unified / Split** setting in the diff header: one column, or removed lines on the left beside the added lines that replace them on the right.
- Images (png, jpg, gif, webp, bmp, ico, svg, avif) open in an image diff instead, for working-tree, commit and stash files, with three modes (saved with the other diff settings): **Side by side**; **Swipe**, the two stacked with a slider that splits old (left) from new (right); and **Fade**, the two stacked with a slider that fades from old to new. An added or deleted image shows its one side, and the mode buttons only appear when there are two versions to compare.
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
    commands.rs          Core git commands: open, diffs, staging, commit, undo, checkout
    state.rs             `repository_state`: status, history, branches, remotes, conflicts, stashes and
                         rewritable commits for each refresh, in one call
    branches.rs          Switch (leaving or bringing changes), rename, delete, merge, rebase onto and squash merge local branches
    commit_actions.rs    Commit menu actions: checkout commit, create branch or tag, cherry-pick, open on GitHub
    history.rs           Revert, reset, squash (only the branch's own commits), delete and push tags
    remote.rs            Remotes, publishing to GitHub, fetch, pull and push
    clone.rs             Cloning from a URL, listing the account's GitHub repositories, picking a folder
    github.rs            GitHub sign-in through git's credential helper (or a token), and GitHub's REST API
    conflicts.rs         Stopped operations and conflicted files: conflict editor data, resolve, continue, abort, AI resolve, merge tool
    stash.rs             One stash per branch: stash, add to it, pop, drop, and their conflicts
    discard.rs           Discarding files and single lines
    edit_file.rs         Reading and saving working-tree files for the in-app editor
    ai_commit.rs         AI commit messages, and running a user's shell command with a timeout
    settings.rs          settings.json: the saved AI and merge tool commands
    recent_repos.rs      Saved list of recently opened repositories, and its commands
    watcher.rs           Watches the open repository's files and tells the window when (and at what time) it changed
    util.rs              Shared helpers: config files, the folder picker, blocking threads, temp folders, safe paths,
                         test repositories
    git/
      runner.rs          Runs the git CLI (no shell, no console window, never prompts); `run_command` and
                         `run_command_with_input` run a prepared `git_command` (extra environment, stdin)
      repository.rs      Holds the open repository (and `git init`); input validation, branch and git-folder helpers
                         (the git folder is looked up once per repository and remembered)
      parsers.rs         Pure functions that parse raw git output (unit tested)
      patch.rs           Tidies diffs, works out which diff lines are staged and builds index content for line staging (unit tested)
      types.rs           Rust mirrors of shared/gitTypes.ts

src/                     UI (React)
  main.tsx, App.tsx      React entry point and root component
  api/gitizen.ts         Implements GitizenApi with Tauri invoke() calls
  styles/theme.css       Theme variables: every colour, plus shared fonts, radii and shadows (light and dark)
  styles/global.css      Base element styles and shared classes (.popover, .button-group, .spinner, .hint)
  context/               React contexts: UI state (view, recent repositories, discard warning) and git state
  hooks/
    useGitOperations.ts  All git state and actions for the app, built from the hooks below
    useCommitSelection.ts  The selected commits (multi-select), their files and the picked file's diff
    useStashSelection.ts   The stash selected in the history, its picked file and that file's diff
    useSync.ts           Fetch, pull, push and publish, the background fetch, and force-push tracking
    useAutoRefresh.ts    Refreshes when the backend's file watcher reports a change no refresh has shown yet, or the
                         window regains focus
    useGitHubAccount.ts  The GitHub sign-in (account, sign in with the credential helper or a token, sign out)
    useDiffSettings.ts   Diff layout and whitespace settings, saved in localStorage
    useSavedCommand.ts   Loads and saves one of the commands kept in settings.json
    useContextMenu.ts    Open/close state of a right-click menu
  utils/                 Pure helpers: commit graph layout, history ranges and squash/reset checks
                         (history.ts), diff line parsing, conflict text, GitHub links, tri-state checkbox logic,
                         formatting, loading in effects (`loadUnlessCancelled`, `loadOrReset`, `attempt`),
                         localStorage (storage.ts, and the per-repository commit drafts in commitDrafts.ts),
                         error normalising
  pages/GitizenView/     Top-level page layout
  components/
    common/              Reusable pieces: DiffView, FileListItem, TriStateCheckbox, ContextMenu, the
                         modals (ActionModal, ConfirmModal, FormModal, CommandModal, DiscardConfirm), and
                         `useMessageFields` (summary and description fields for dialogs that write a commit message)
    Branches/            Branch menu entries and the rename, delete and squash dialogs
    Conflicts/           Conflict banner, conflict editor, Mark resolved and Abort buttons
    Stash/               Stash file list, Pop/Discard, finish button, conflict warning, shared stash menu items
    EmptyRepositoryView/ Start screen before a repository is open
    ErrorModal/          Pops up failed operations; offers git init for non-repositories
    RepositoryHeader/    Top bar: repo switcher, branch switcher, sync controls and publish modal, GitHub account
    GitHub/              The GitHub account button, sign-in modal, and `useSignInPrompt` for modals that need a sign-in
    Clone/               The clone modal (from GitHub or a URL)
    RepoSidebar/         Left sidebar: working-tree files, commit form, commit files
    RepoPanel/           Main panel: commit history graph (multi-select), commit menu and its dialogs
                         (branch, tag, cherry-pick, squash, reset, delete tag), file diff and editor
```

## Conventions
- Each component lives next to its own CSS file, grouped in a folder by the area of the screen it belongs to.
- CSS never names a colour directly: it reads the variables in `src/styles/theme.css` (add one there if nothing fits), and reuses the shared classes in `global.css` (`.popover`, `.button-group`, `.spinner`, `.hint`, and `.modal-form` with `.field-row` and `.modal-check` in ActionModal.css) instead of restyling them.
- Anything returned by the backend is typed in `shared/gitTypes.ts` and mirrored in `src-tauri/src/git/types.rs` (or next to the command in its module). A new git operation gets a name in `Command` (`shared/ipc.ts`), a method in `GitizenApi`, a call in `src/api/gitizen.ts` (TypeScript checks it matches `GitizenApi`), and a `#[tauri::command]` in one of the backend modules, registered in `lib.rs`.
- A backend command is a thin `async` wrapper that gets the open repository and calls a plain `*_in(dir, …)` function, which is what the Rust tests call. Slow commands (network, AI, an external merge tool) run through `util::blocking` so other commands keep answering.
- Commands reject with git's message as a plain string. The exception is opening a repository, which rejects with an `OpenRepositoryError` object (`{ kind: "notARepository", path, message }` or `{ kind: "failed", message }`, `OpenError` in Rust) so the UI can offer to create one. `useGitOperations` normalises every failure into that shape for the error modal.
- Actions in `useGitOperations` resolve to true or false and never reject: on failure the error modal already shows git's message. Each one refreshes the git state after it runs (and only once: see `useAutoRefresh`).
- Keep git calls few: anything every refresh needs goes into `repository_state` (sharing its `git status` output where it can) rather than a command of its own, loops over files or branches use one git call for all of them where git allows it, and git-folder files are found with `git_path` (no git call once the folder is known). `attempt` (utils/load.ts) is the shared "run it, report a failure, resolve to a boolean" helper.
- Operations that can stop on conflicts (merge, pull, cherry-pick, rebase, continue, stash) treat stopping with unmerged files as success, and the conflict editor takes over.
- Tauri maps camelCase argument names from the UI to snake_case Rust parameters (`oldPath` becomes `old_path`).
- Parsing logic is kept in pure functions (`src-tauri/src/git/parsers.rs`, `src/utils/`) so it can be unit tested without Tauri or React.
- Git is run through the git CLI, so it must be installed and on PATH. GitHub's API is called from Rust with `ureq`.

## Requirements
- Node.js, Git, and the Rust toolchain (rustup) with the Microsoft C++ Build Tools on Windows. See https://v2.tauri.app/start/prerequisites/.
- Git 2.41 or newer counts every branch's ahead/behind in one command; older git works, with one command per branch (run side by side).
- Optional: any command line AI tool that reads stdin (e.g. `claude -p`) for AI commit messages and conflict resolving.

## Scripts
- `npm run app:dev`: start Vite and the Tauri app in development mode
- `npm run app:build`: type-check, bundle and package an installer with Tauri
- `npm run dev` / `npm run build`: the UI alone (Tauri runs these itself)
- `npm run lint`: ESLint with zero warnings allowed
- `cargo test --manifest-path src-tauri/Cargo.toml`: Rust unit tests
