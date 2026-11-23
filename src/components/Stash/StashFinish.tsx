import "./Stash.css";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { pluralize } from "../../utils/format";

/**
 * Takes the commit form's place while adding to the stash, or popping it,
 * stopped on conflicts: once every file is resolved, saves the combined
 * stash or finishes popping (no commit is made either way).
 */
export default function StashFinish(): React.JSX.Element {
  const {
    conflicts: { operation, files },
    continueOperation,
  } = useGitOperationsContext();
  const popping = operation === "stashPop";

  return (
    <div className="commit stash-finish">
      <p>
        {files.length > 0
          ? `Resolve ${pluralize(files.length, "conflicted file")}, then ${popping ? "finish popping the stash" : "save the stash"}.`
          : popping
            ? "All conflicts resolved. Finish to drop the stash and keep its changes here."
            : "All conflicts resolved. Save to keep the combined changes in the stash."}
      </p>
      <button
        className="primary"
        disabled={files.length > 0}
        title={files.length > 0 ? "Resolve every conflicted file first" : undefined}
        onClick={() => void continueOperation()}
      >
        {popping ? "Finish popping stash" : "Save stash"}
      </button>
    </div>
  );
}
