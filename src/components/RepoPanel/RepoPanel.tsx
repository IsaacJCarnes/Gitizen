import "./RepoPanel.css";
import { useEffect } from "react";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import ConflictEditor from "../Conflicts/ConflictEditor";
import CommitHistory from "./CommitHistory";
import FileDiff from "./FileDiff";

/**
 * Main panel: the commit history graph, a file's diff when one is open, or
 * the conflict editor for a conflicted file.
 */
export default function RepoPanel(): React.JSX.Element {
  const { view, setView } = useAppContext();
  const { conflicts, selectedConflict } = useGitOperationsContext();

  // Open the editor when a conflicted file gets selected (also by itself
  // when an operation stops), and leave it once nothing is in progress.
  useEffect(() => {
    if (selectedConflict) setView("conflict");
  }, [selectedConflict, setView]);
  useEffect(() => {
    if (!conflicts.operation && view === "conflict") setView("history");
  }, [conflicts.operation, view, setView]);

  let content: React.JSX.Element;
  if (view === "diff") content = <FileDiff />;
  else if (view === "conflict" && selectedConflict) {
    // A key per file so each one starts with fresh picks and output.
    content = <ConflictEditor key={selectedConflict} path={selectedConflict} />;
  } else content = <CommitHistory />;

  return <section className="repo-panel">{content}</section>;
}
