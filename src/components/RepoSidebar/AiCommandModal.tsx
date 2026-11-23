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
 * Sets up the AI command line tool: Gitizen pipes a prompt (plus the staged
 * diff, or a conflicted file) to its stdin and reads the commit message (or
 * the resolved file) from its stdout.
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
      title="Set up AI merge resolve"
      onDismiss={onDismiss}
      actions={[{ label: "Save", primary: true, onClick: save }]}
    >
      <p>
        Enter a command that reads stdin and prints a response, such as{" "}
        <code>claude -p</code>. It runs in the repository folder to generate
        commit messages and resolve conflicts. For commits, it fills in only the
        summary and description. 
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
      <small>Nothing will be staged or committed.</small>
    </ActionModal>
  );
}
