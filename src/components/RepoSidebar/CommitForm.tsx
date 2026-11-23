import "./CommitForm.css";
import { useState } from "react";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { useAiCommitCommand } from "../../hooks/useSavedCommand";
import { OPERATION_NAME } from "../../utils/conflictText";
import { pluralize } from "../../utils/format";
import AiCommitCommandModal from "./AiCommitCommandModal";

/**
 * Commit summary (required, one line) and description (optional) with the
 * commit button; commits whatever is currently staged. "Generate message"
 * fills both fields from the staged diff using the user's AI command, and
 * asks for that command first if none is set up.
 */
export default function CommitForm(): React.JSX.Element {
  const {
    status,
    commitSummary,
    setCommitSummary,
    commitDescription,
    setCommitDescription,
    commitChanges,
    conflicts: { operation, files },
    amending,
    cancelAmend,
    generatingMessage,
    generateCommitMessage,
  } = useGitOperationsContext();
  const { command: aiCommand, save: saveAiCommand } = useAiCommitCommand();
  // Which button opened the AI command modal: "generate" runs it once saved.
  const [settingUp, setSettingUp] = useState<"change" | "generate" | null>(
    null,
  );
  const stagedCount = status?.files.filter((file) => file.staged).length ?? 0;
  // Committing is blocked until every conflict is resolved.
  const conflictCount = files.length;
  // Amending may just reword the last commit, and finishing a merge may
  // keep only the current side, so neither needs anything staged.
  const canCommit =
    commitSummary.trim() !== "" &&
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
      <input
        type="text"
        placeholder="Summary (required)"
        aria-label="Commit summary"
        value={commitSummary}
        readOnly={generatingMessage}
        onChange={(event) => setCommitSummary(event.target.value)}
        onKeyDown={commitOnCtrlEnter}
      />
      <div className="description-container">
        <textarea
          placeholder={
            generatingMessage ? "Writing a commit message…" : "Description"
          }
          aria-label="Commit description"
          value={commitDescription}
          readOnly={generatingMessage}
          onChange={(event) => setCommitDescription(event.target.value)}
          onKeyDown={commitOnCtrlEnter}
        />
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
      </div>
      {amending ? (
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
        <button
          className="primary"
          disabled={!canCommit}
          title={
            conflictCount > 0
              ? "Resolve every conflicted file first"
              : undefined
          }
          onClick={commitChanges}
        >
          {operation
            ? `Commit ${OPERATION_NAME[operation]}`
            : `Commit ${pluralize(stagedCount, "file")}`}
        </button>
      )}
      {settingUp && (
        <AiCommitCommandModal
          initialCommand={aiCommand ?? ""}
          onSave={saveCommand}
          onDismiss={() => setSettingUp(null)}
        />
      )}
    </div>
  );
}
