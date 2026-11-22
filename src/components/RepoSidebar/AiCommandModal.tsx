import { useState } from "react";
import ActionModal from "../common/ActionModal";

interface AiCommandModalProps {
  /** The command saved now ("" if none). */
  initialCommand: string;
  /** Called with the trimmed command when the user saves. */
  onSave: (command: string) => void;
  onDismiss: () => void;
}

/**
 * Sets up the command line tool that writes commit messages: Gitizen pipes
 * a prompt plus the staged diff to its stdin and reads the message from its
 * stdout.
 */
export default function AiCommandModal({
  initialCommand,
  onSave,
  onDismiss,
}: AiCommandModalProps): React.JSX.Element {
  const [command, setCommand] = useState(initialCommand);
  const save = (): void => onSave(command.trim());

  return (
    <ActionModal
      title="Set up AI commit messages"
      onDismiss={onDismiss}
      actions={[{ label: "Save", primary: true, onClick: save }]}
    >
      <p>
        Enter a command that reads a prompt on stdin and prints a commit message,
        for example <code>claude -p</code>. It runs in the repository folder, the
        same way it would in a terminal.
      </p>
      <input
        type="text"
        className="ai-command-input"
        aria-label="AI command"
        placeholder="claude -p"
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
      <p>Gitizen only fills in the summary and description. Nothing is staged or committed for you.</p>
    </ActionModal>
  );
}
