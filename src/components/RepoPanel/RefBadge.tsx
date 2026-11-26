import type { GitRef } from "../../../shared/gitTypes";

interface RefBadgeProps {
  gitRef: GitRef;
  /** Lane colour of the commit the ref points at. */
  color: string;
  /** Set for a local branch that isn't checked out: double-clicking checks it out. */
  onCheckout?: () => void;
}

/** Pill showing a branch, remote branch or tag name next to a commit. */
export default function RefBadge({ gitRef, color, onCheckout }: RefBadgeProps): React.JSX.Element {
  return (
    <span
      className={`ref ref-${gitRef.type}${gitRef.current ? " current" : ""}`}
      style={{ borderColor: color }}
      title={onCheckout ? `Double-click to check out ${gitRef.name}` : undefined}
      onDoubleClick={
        onCheckout &&
        ((event) => {
          event.stopPropagation();
          onCheckout();
        })
      }
    >
      {gitRef.type === "tag" ? "◆ " : ""}
      {gitRef.name}
    </span>
  );
}
