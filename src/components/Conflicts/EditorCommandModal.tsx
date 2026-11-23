import CommandModal, { type CommandSetupProps } from "../common/CommandModal";

/**
 * Sets the external tool that opens conflicted files. Empty falls back to
 * git's configured merge tool, or the system text editor.
 */
export default function EditorCommandModal(props: CommandSetupProps): React.JSX.Element {
  return (
    <CommandModal
      {...props}
      title="External merge tool"
      label="External tool command"
      placeholder="code {file}"
    >
      <p>
        Enter a command to open conflicted files. Use <code>{"{file}"}</code> for the file path;
        otherwise, the path is added at the end. For example, <code>code {"{file}"}</code>.
      </p>
      <p>
        Leave blank to use Git's configured merge tool, or your system text editor if none is
        set.
      </p>
    </CommandModal>
  );
}
