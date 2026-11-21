import "./CommitSummary.css";
import type { GitCommit } from "../../../shared/gitTypes";
import { shortHash } from "../../utils/format";

/** Header for a selected commit: subject, body, short hash, author and date. */
export default function CommitSummary({ commit }: { commit: GitCommit }): React.JSX.Element {
  return (
    <div className="commit-summary">
      <b>{commit.message}</b>
      {commit.body && <p>{commit.body}</p>}
      <small>
        {shortHash(commit.hash)} by {commit.author} on{" "}
        {new Date(commit.date).toLocaleString()}
      </small>
    </div>
  );
}
