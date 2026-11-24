import { useState, type ReactNode } from "react";
import type { SavedCommandKind } from "../../../shared/gitTypes";
import ActionModal from "./ActionModal";

/** What each saved command's setup modal says. */
const COPY: Record<
  SavedCommandKind,
  { title: string; label: string; placeholder: string; body: ReactNode; footnote?: string }
> = {
  // Gitizen pipes a prompt plus the staged diff to its stdin and reads the
  // message from its stdout.
  aiCommit: {
    title: "Set up AI commit message",
    label: "AI commit command",
    placeholder: "claude -p",
    body: (
      <p>
        Enter a command that reads stdin and prints a response, such as <code>claude -p</code>. It
        runs in the repository folder to generate commit messages. It fills in only the summary
        and description.
      </p>
    ),
    footnote: "Nothing will be staged or committed.",
  },
  // Gitizen pipes a prompt plus the conflicted file to its stdin and reads
  // the resolved file from its stdout.
  aiResolve: {
    title: "Set up AI merge resolve",
    label: "AI resolve command",
    placeholder: "claude -p",
    body: (
      <p>
        Enter a command that reads stdin and prints a response, such as <code>claude -p</code>. It
        runs in the repository folder to resolve conflicts. It fills in only the output, for you
        to review and save.
      </p>
    ),
    footnote: "Nothing will be staged or committed.",
  },
  // Empty falls back to git's configured merge tool, or the text editor.
  editor: {
    title: "External merge tool",
    label: "External tool command",
    placeholder: "code {file}",
    body: (
      <>
        <p>
          Enter a command to open conflicted files. Use <code>{"{file}"}</code> for the file path;
          otherwise, the path is added at the end. For example, <code>code {"{file}"}</code>.
        </p>
        <p>
          Leave blank to use Git&apos;s configured merge tool, or your system text editor if none
          is set.
        </p>
      </>
    ),
  },
};

interface CommandModalProps {
  /** Which saved command is being set up. */
  which: SavedCommandKind;
  /** The command saved now ("" when none is set). */
  initialCommand: string;
  /** Called with the trimmed command when the user saves (Enter or Save). */
  onSave: (command: string) => void;
  onDismiss: () => void;
}

/** Asks for one of the command lines Gitizen saves, e.g. the AI command or the external merge tool. */
export default function CommandModal({
  which,
  initialCommand,
  onSave,
  onDismiss,
}: CommandModalProps): React.JSX.Element {
  const { title, label, placeholder, body, footnote } = COPY[which];
  const [command, setCommand] = useState(initialCommand);
  const save = (): void => onSave(command.trim());

  return (
    <ActionModal
      title={title}
      onDismiss={onDismiss}
      actions={[{ label: "Save", primary: true, onClick: save }]}
    >
      {body}
      <input
        type="text"
        className="command-input"
        aria-label={label}
        placeholder={placeholder}
        value={command}
        autoFocus
        onChange={(event) => setCommand(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            save();
          }
        }}
      />
      {footnote && <small>{footnote}</small>}
    </ActionModal>
  );
}
