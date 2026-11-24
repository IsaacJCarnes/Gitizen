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
  /** Optional control after the path, e.g. a Mark resolved button. */
  trailing?: ReactNode;
  /** Extra class for the row, e.g. "conflicted". */
  className?: string;
  /** Right-click on the row, e.g. to open its menu. */
  onContextMenu?: (event: React.MouseEvent) => void;
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
  trailing,
  className,
  onContextMenu,
}: FileListItemProps): React.JSX.Element {
  const classes = [selected ? "on" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <li className={classes} onContextMenu={onContextMenu}>
      {leading}
      <button className="name" title={title} onClick={onSelect}>
        <span className={`code c-${code}`}>{code}</span>
        {path}
      </button>
      {trailing}
    </li>
  );
}
