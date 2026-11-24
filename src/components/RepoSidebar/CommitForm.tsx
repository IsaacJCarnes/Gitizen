import "./CommitForm.css";
import { useState } from "react";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { useSavedCommand } from "../../hooks/useSavedCommand";
import { OPERATION_NAME } from "../../utils/conflictText";
import { pluralize } from "../../utils/format";
import AbortOperationButton from "../Conflicts/AbortOperationButton";
import CommandModal from "../common/CommandModal";

/**
 * Commit summary (required, one line) and description (optional) with the
 * commit button; commits whatever is currently staged. "Generate message"
 * fills both fields from the staged diff using the user's AI command, and
 * asks for that command first if none is set up.
 *
 * While a merge, cherry-pick, revert or squash merge is stopped, the
 * commit button finishes it and an Abort button beside it abandons it.
 * During a rebase the form only shows which step it is on, with "Continue
 * rebase" (git commits each step with that commit's own message) and
 * "Abort Rebase".
 */
export default function CommitForm(): React.JSX.Element {
  const {
    status,
    commitSummary,
    setCommitSummary,
    commitDescription,
    setCommitDescription,
    commitChanges,
    conflicts: { operation, files, step },
    amending,
    cancelAmend,
    generatingMessage,
    generateCommitMessage,
  } = useGitOperationsContext();
  const { command: aiCommand, save: saveAiCommand } = useSavedCommand("aiCommit");
  // Which button opened the AI command modal: "generate" runs it once saved.
  const [settingUp, setSettingUp] = useState<"change" | "generate" | null>(
    null,
  );
  const stagedCount = status?.files.filter((file) => file.staged).length ?? 0;
  // Committing is blocked until every conflict is resolved.
  const conflictCount = files.length;
  const rebasing = operation === "rebase";
  // Amending may just reword the last commit, and finishing a merge may
  // keep only the current side, so neither needs anything staged.
  const canCommit = rebasing
    ? conflictCount === 0
    : commitSummary.trim() !== "" &&
      (stagedCount > 0 || amending || operation !== null) &&
      conflictCount === 0 &&
      !generatingMessage;

  // Ctrl+Enter (Cmd+Enter on macOS) in either field commits.
  const commitOnCtrlEnter = (event: React.KeyboardEvent): void => {
    if (
      event.key === "Enter" &&
      (event.ctrlKey || event.metaKey) &&
      canCommit
    ) {
      event.preventDefault();
      void commitChanges();
    }
  };

  const generate = (): void => {
    if (aiCommand) void generateCommitMessage();
    else setSettingUp("generate");
  };

  const saveCommand = (command: string): void => {
    const generateAfter = settingUp === "generate";
    setSettingUp(null);
    void saveAiCommand(command).then((saved) => {
      if (generateAfter && saved) void generateCommitMessage();
    });
  };

  return (
    <div className="commit">
      {!rebasing && (
        <input
          type="text"
          placeholder="Summary (required)"
          aria-label="Commit summary"
          value={commitSummary}
          readOnly={generatingMessage}
          onChange={(event) => setCommitSummary(event.target.value)}
          onKeyDown={commitOnCtrlEnter}
        />
      )}
      <div className="description-container">
        <textarea
          placeholder={
            generatingMessage ? "Writing a commit message…" : "Description"
          }
          aria-label={rebasing ? "Rebase progress" : "Commit description"}
          value={
            rebasing
              ? step
                ? `Rebase ${step.current} out of ${step.total}`
                : "Rebase in progress"
              : commitDescription
          }
          readOnly={generatingMessage}
          disabled={rebasing}
          onChange={(event) => setCommitDescription(event.target.value)}
          onKeyDown={commitOnCtrlEnter}
        />
        {!rebasing && (
          <span className="commit-generate">
            <button
              className="commit-generate-button"
              disabled={
                operation !== null ||
                stagedCount === 0 ||
                generatingMessage ||
                aiCommand === null
              }
              title={
                operation !== null
                  ? "Fix conflicts before generating a message"
                  : stagedCount === 0
                    ? "Stage changes to generate a message for them"
                    : aiCommand
                      ? `Write the message with AI`
                      : "Set up an AI command to write commit messages"
              }
              onClick={generate}
            >
              {generatingMessage ? (
                <div className="commit-spinner" aria-hidden="true"></div>
              ) : (
                <>&#10023;</>
              )}
            </button>
            <button
              className="commit-generate-settings"
              aria-label="AI commit message settings"
              title="AI commit message settings"
              disabled={generatingMessage || aiCommand === null}
              onClick={() => setSettingUp("change")}
            >
              &#9881;
            </button>
          </span>
        )}
      </div>
      {operation ? (
        // Finishing (or abandoning) the stopped merge, rebase and so on.
        <div className="commit-amend">
          <button
            className="primary"
            disabled={!canCommit}
            title={conflictCount > 0 ? "Resolve every conflicted file first" : undefined}
            onClick={commitChanges}
          >
            {rebasing ? "Continue rebase" : `Commit ${OPERATION_NAME[operation]}`}
          </button>
          <AbortOperationButton />
        </div>
      ) : amending ? (
        <div className="commit-amend">
          <button
            className="primary"
            disabled={!canCommit}
            onClick={commitChanges}
          >
            Amend last commit
            {stagedCount > 0 && ` (+${pluralize(stagedCount, "file")})`}
          </button>
          <button onClick={cancelAmend}>Cancel</button>
        </div>
      ) : (
        <button className="primary" disabled={!canCommit} onClick={commitChanges}>
          Commit {pluralize(stagedCount, "file")}
        </button>
      )}
      {settingUp && (
        <CommandModal
          which="aiCommit"
          initialCommand={aiCommand ?? ""}
          onSave={saveCommand}
          onDismiss={() => setSettingUp(null)}
        />
      )}
    </div>
  );
}
