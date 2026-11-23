import "./Conflicts.css";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import {
  FINISHES_WITHOUT_COMMIT,
  OPERATION_NAME,
} from "../../utils/conflictText";
import { pluralize } from "../../utils/format";
import AbortOperationButton from "./AbortOperationButton";

/**
 * Sits above the changed files while a merge, cherry-pick, rebase or revert
 * is stopped: how many conflicts are left (committing is blocked until
 * none), and a button to abort the whole operation. A rebase's abort
 * button sits beside "Continue rebase" in the commit form instead.
 */
export default function ConflictBanner(): React.JSX.Element | null {
  const {
    conflicts: { operation, files, incoming, current },
  } = useGitOperationsContext();
  if (!operation) return null;
  const name = OPERATION_NAME[operation];
  // Stash operations finish from the sidebar's button and a rebase with
  // "Continue rebase", not with a commit.
  let finish = "commit";
  if (FINISHES_WITHOUT_COMMIT.has(operation)) finish = "finish";
  if (operation === "rebase") finish = "continue";

  return (
    <div className="conflict-banner">
      <span>
        {/* e.g. "Cherry-pick in progress" */}
        <b>{name[0].toUpperCase() + name.slice(1)} in progress</b>
        {incoming && current && (
          <span
            className="conflict-branches"
            title={`${incoming} into ${current}`}
          >
            {incoming} → {current}
          </span>
        )}
        <small>
          {files.length > 0
            ? `Resolve ${pluralize(files.length, "conflicted file")} to ${finish}`
            : finish === "commit"
              ? "All conflicts resolved. Commit to finish it."
              : finish === "continue"
                ? "All conflicts resolved. Continue the rebase below."
                : "All conflicts resolved. Finish it below."}
        </small>
      </span>
      {operation !== "rebase" && <AbortOperationButton />}
    </div>
  );
}
