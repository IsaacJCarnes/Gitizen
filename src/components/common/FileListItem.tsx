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
  /** Optional control before the status code, e.g. a stage checkbox. */
  leading?: ReactNode;
}

/**
 * One row of a changed-file list: an optional leading control, status code
 * and path. Render inside a `<ul className="file-change-list">`.
 */
export default function FileListItem({
  path,
  code,
  selected,
  onSelect,
  title,
  leading,
}: FileListItemProps): React.JSX.Element {
  return (
    <li className={selected ? "on" : ""}>
      {leading}
      <button className="name" title={title} onClick={onSelect}>
        <span className={`code c-${code}`}>{code}</span>
        {path}
      </button>
    </li>
  );
}
