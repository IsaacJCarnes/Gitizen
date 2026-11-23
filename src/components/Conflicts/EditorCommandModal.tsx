import { useState } from "react";
import ActionModal from "../common/ActionModal";

interface EditorCommandModalProps {
  /** The command saved now ("" when none is set). */
  initialCommand: string;
  /** Called with the trimmed command when the user saves. */
  onSave: (command: string) => void;
  onDismiss: () => void;
}

/**
 * Sets the external tool that opens conflicted files. Empty falls back to
 * git's configured merge tool, or the system text editor.
 */
export default function EditorCommandModal({
  initialCommand,
  onSave,
  onDismiss,
}: EditorCommandModalProps): React.JSX.Element {
  const [command, setCommand] = useState(initialCommand);
  const save = (): void => onSave(command.trim());

  return (
    <ActionModal
      title="External merge tool"
      onDismiss={onDismiss}
      actions={[{ label: "Save", primary: true, onClick: save }]}
    >
      <p>
        Enter a command to open conflicted files. Use <code>{"{file}"}</code> for the file path;
        otherwise, the path is added at the end. For example, <code>code {"{file}"}</code>.
      </p>
      <p>
        Leave blank to use Git's configured merge tool, or your system text editor if none is
        set.
      </p>
      <input
        type="text"
        className="editor-command-input"
        aria-label="External tool command"
        placeholder="code {file}"
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
    </ActionModal>
  );
}
