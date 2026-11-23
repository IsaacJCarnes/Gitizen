import { useState, type ReactNode } from "react";
import ActionModal from "./ActionModal";

interface CommandModalProps {
  title: string;
  /** The input's accessible name. */
  label: string;
  placeholder: string;
  /** The command saved now ("" when none is set). */
  initialCommand: string;
  /** Called with the trimmed command when the user saves (Enter or Save). */
  onSave: (command: string) => void;
  onDismiss: () => void;
  /** What the command is for and how it is run, shown above the input. */
  children: ReactNode;
  /** Optional small print below the input. */
  footnote?: ReactNode;
}

/** The props a modal for one particular command passes through. */
export type CommandSetupProps = Pick<CommandModalProps, "initialCommand" | "onSave" | "onDismiss">;

/** Asks for a command line, e.g. the AI command or the external merge tool. */
export default function CommandModal({
  title,
  label,
  placeholder,
  initialCommand,
  onSave,
  onDismiss,
  children,
  footnote,
}: CommandModalProps): React.JSX.Element {
  const [command, setCommand] = useState(initialCommand);
  const save = (): void => onSave(command.trim());

  return (
    <ActionModal
      title={title}
      onDismiss={onDismiss}
      actions={[{ label: "Save", primary: true, onClick: save }]}
    >
      {children}
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
