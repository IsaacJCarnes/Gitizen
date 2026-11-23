import CommandModal, { type CommandSetupProps } from "../common/CommandModal";

/**
 * Sets up the AI command that resolves conflicts: Gitizen pipes a prompt
 * plus the conflicted file to its stdin and reads the resolved file from its
 * stdout. Saved separately from the commit message command.
 */
export default function AiResolveCommandModal(props: CommandSetupProps): React.JSX.Element {
  return (
    <CommandModal
      {...props}
      title="Set up AI merge resolve"
      label="AI resolve command"
      placeholder="claude -p"
      footnote="Nothing will be staged or committed."
    >
      <p>
        Enter a command that reads stdin and prints a response, such as{" "}
        <code>claude -p</code>. It runs in the repository folder to resolve
        conflicts. It fills in only the output, for you to review and save.
      </p>
    </CommandModal>
  );
}
