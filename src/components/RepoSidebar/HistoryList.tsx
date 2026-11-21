import "./HistoryList.css";
import { useGitOperationsContext } from "../../context/GitOperationsContext";

export default function HistoryList(): React.JSX.Element {
  const { commits, selectedCommit, selectCommit } = useGitOperationsContext();

  if (commits.length === 0) {
    return <p className="history-empty">No commits yet.</p>;
  }

  return (
    <ol className="history-list">
      {commits.map((commit) => (
        <li
          key={commit.hash}
          className={selectedCommit?.hash === commit.hash ? "on" : ""}
        >
          <button onClick={() => selectCommit(commit)}>
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
