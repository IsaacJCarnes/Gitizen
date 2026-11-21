import "./FileList.css";
import type { ReactNode } from "react";

interface FileListItemProps {
  path: string;
  /** Single-letter git status code shown before the path. */
  code: string;
  selected: boolean;
  onSelect: () => void;
  /** Optional tooltip for the path. */
  title?: string;
  /** Optional trailing control, e.g. a Stage/Unstage button. */
  action?: ReactNode;
}

/**
 * One row of a changed-file list: status code, path and an optional action.
 * Render inside a `<ul className="file-change-list">`.
 */
export default function FileListItem({
  path,
  code,
  selected,
  onSelect,
  title,
  action,
}: FileListItemProps): React.JSX.Element {
  return (
    <li className={selected ? "on" : ""}>
      <button className="name" title={title} onClick={onSelect}>
        <span className={`code c-${code}`}>{code}</span>
        {path}
      </button>
      {action}
    </li>
  );
}
