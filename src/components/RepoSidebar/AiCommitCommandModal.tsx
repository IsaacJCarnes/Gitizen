import CommandModal, { type CommandSetupProps } from "../common/CommandModal";

/**
 * Sets up the AI command that writes commit messages: Gitizen pipes a
 * prompt plus the staged diff to its stdin and reads the message from its
 * stdout. Saved separately from the conflict resolve command.
 */
export default function AiCommitCommandModal(props: CommandSetupProps): React.JSX.Element {
  return (
    <CommandModal
      {...props}
      title="Set up AI commit message"
      label="AI commit command"
      placeholder="claude -p"
      footnote="Nothing will be staged or committed."
    >
      <p>
        Enter a command that reads stdin and prints a response, such as{" "}
        <code>claude -p</code>. It runs in the repository folder to generate
        commit messages. It fills in only the summary and description.
      </p>
    </CommandModal>
  );
}
