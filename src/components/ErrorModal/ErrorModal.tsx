import { useGitOperationsContext } from "../../context/GitOperationsContext";
import ActionModal from "../common/ActionModal";

/**
 * Pops up whenever a git operation fails. A folder that isn't a repository
 * gets a "Create repository" action that runs `git init` there and opens it;
 * other errors just show git's message.
 */
export default function ErrorModal(): React.JSX.Element | null {
  const { error, dismissError, initRepository } = useGitOperationsContext();
  if (!error) return null;

  if (error.kind === "notARepository") {
    const { path } = error;
    return (
      <ActionModal
        title="Not a git repository"
        onDismiss={dismissError}
        actions={[
          {
            label: "Create repository",
            primary: true,
            onClick: () => {
              dismissError();
              void initRepository(path);
            },
          },
        ]}
      >
        <p><code>{path}</code> isn't a git repository yet.</p>
        <p>Create a new repository in this folder? This runs <code>git init</code> there; existing files are left as they are.</p>
      </ActionModal>
    );
  }

  return (
    <ActionModal title="Something went wrong" onDismiss={dismissError}>
      {error.message}
    </ActionModal>
  );
}
