import "./CommitSummary.css";
import { useState } from "react";
import type { GitCommit } from "../../../shared/gitTypes";
import { shortHash } from "../../utils/format";

/**
 * Header for a selected commit: subject, body, short hash, author and date.
 * The arrow beside the subject collapses it to just the subject; that stays
 * as chosen while other commits are picked.
 */
export default function CommitSummary({ commit }: { commit: GitCommit }): React.JSX.Element {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="commit-summary">
      <div className="commit-summary-title">
        <button
          className="commit-summary-toggle"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse commit details" : "Expand commit details"}
          title={expanded ? "Collapse" : "Expand"}
          onClick={() => setExpanded((open) => !open)}
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
        </button>
        <b>{commit.message}</b>
      </div>
      {expanded && (
        <>
          {commit.body && <p>{commit.body}</p>}
          <small>
            {shortHash(commit.hash)} by {commit.author} on{" "}
            {new Date(commit.date).toLocaleString()}
          </small>
        </>
      )}
    </div>
  );
}
