import "./CommitForm.css";
import { useEffect, useState } from "react";
import { gitizen } from "../../api/gitizen";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { OPERATION_NAME } from "../../utils/conflictText";
import { pluralize } from "../../utils/format";
import AiCommandModal from "./AiCommandModal";

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
    conflicts,
    amending,
    cancelAmend,
    generatingMessage,
    generateCommitMessage,
    reportError,
  } = useGitOperationsContext();
  // null until loaded from the backend; "" means not set up.
  const [aiCommand, setAiCommand] = useState<string | null>(null);
  const [settingUp, setSettingUp] = useState<"change" | "generate" | null>(
    null,
  );
  const stagedCount = status?.files.filter((file) => file.staged).length ?? 0;
  // Committing is blocked until every conflict is resolved.
  const conflictCount = conflicts.files.length;
  // Amending may just reword the last commit, and finishing a merge may
  // keep only the current side, so neither needs anything staged.
  const canCommit =
    commitSummary.trim() !== "" &&
    (stagedCount > 0 || amending || conflicts.operation !== null) &&
    conflictCount === 0 &&
    !generatingMessage;

  useEffect(() => {
    gitizen.aiCommitCommand().then(setAiCommand, () => setAiCommand(""));
  }, []);

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
    gitizen.setAiCommitCommand(command).then((saved) => {
      setAiCommand(saved);
      if (generateAfter && saved) void generateCommitMessage();
    }, reportError);
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
      <div className="commit-generate">
        <button
          className="commit-generate-button"
          disabled={
            stagedCount === 0 || generatingMessage || aiCommand === null
          }
          title={
            stagedCount === 0
              ? "Stage changes to generate a message for them"
              : aiCommand
                ? `Write the message with AI`
                : "Set up an AI command to write commit messages"
          }
          onClick={generate}
        >
          {generatingMessage ? (
            <>
              <span className="commit-spinner" aria-hidden="true" /> Generating…
            </>
          ) : (
            "Generate message"
          )}
        </button>
        <button
          className="commit-generate-settings"
          aria-label="AI command settings"
          title="AI command settings"
          disabled={generatingMessage || aiCommand === null}
          onClick={() => setSettingUp("change")}
        >
          &#9881;
        </button>
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
          {conflicts.operation
            ? `Commit ${OPERATION_NAME[conflicts.operation]}`
            : `Commit ${pluralize(stagedCount, "file")}`}
        </button>
      )}
      {settingUp && (
        <AiCommandModal
          initialCommand={aiCommand ?? ""}
          onSave={saveCommand}
          onDismiss={() => setSettingUp(null)}
        />
      )}
    </div>
  );
}
