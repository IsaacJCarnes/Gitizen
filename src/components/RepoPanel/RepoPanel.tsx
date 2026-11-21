import "./RepoPanel.css";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import CommitDetails from "./CommitDetails";
import DiffView from "./DiffView";

export default function RepoPanel(): React.JSX.Element {
  const { view, selectedFile, diff } = useGitOperationsContext();

  return (
    <section className="center">
      {view === "history" ? (
        <CommitDetails />
      ) : selectedFile ? (
        <DiffView diff={diff} />
      ) : (
        <p className="placeholder">Select a file to see its changes.</p>
      )}
    </section>
  );
}
