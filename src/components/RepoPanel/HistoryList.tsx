import "./HistoryList.css";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import type { GitCommit } from "../../types/git";

export default function HistoryList(): React.JSX.Element {
  const { commits, status, selectedCommit, selectCommit } =
    useGitOperationsContext();
  const changeCount = status?.files.length ?? 0;

  const select = (commit: GitCommit | null): void => {
    if (commit?.hash !== selectedCommit?.hash) selectCommit(commit);
  };

  return (
    <ol className="history-list">
      <li className={`pending${selectedCommit ? "" : " on"}`}>
        <button onClick={() => select(null)}>
          <b>Uncommitted changes</b>
          <small>
            {changeCount === 0
              ? "Working tree clean"
              : `${changeCount} changed file${changeCount === 1 ? "" : "s"}`}
          </small>
        </button>
      </li>
      {commits.map((commit) => (
        <li
          key={commit.hash}
          className={selectedCommit?.hash === commit.hash ? "on" : ""}
        >
          <button onClick={() => select(commit)}>
            <b>{commit.message}</b>
            <small>
              {commit.hash.slice(0, 7)} by {commit.author} on{" "}
              {new Date(commit.date).toLocaleDateString()}
            </small>
          </button>
        </li>
      ))}
    </ol>
  );
}
