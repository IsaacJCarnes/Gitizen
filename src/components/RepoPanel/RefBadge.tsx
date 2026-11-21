import type { GitRef } from "../../../shared/gitTypes";

interface RefBadgeProps {
  gitRef: GitRef;
  /** Lane colour of the commit the ref points at. */
  color: string;
}

/** Pill showing a branch, remote branch or tag name next to a commit. */
export default function RefBadge({ gitRef, color }: RefBadgeProps): React.JSX.Element {
  return (
    <span
      className={`ref ref-${gitRef.type}${gitRef.current ? " current" : ""}`}
      style={{ borderColor: color }}
    >
      {gitRef.type === "tag" ? "◆ " : ""}
      {gitRef.name}
    </span>
  );
}
