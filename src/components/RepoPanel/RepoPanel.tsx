import "./RepoPanel.css";
import { useAppContext } from "../../context/AppContext";
import CommitHistory from "./CommitHistory";
import FileDiff from "./FileDiff";

/** Main panel: the commit history graph, or a file's diff when one is open. */
export default function RepoPanel(): React.JSX.Element {
  const { view } = useAppContext();

  return (
    <section className="repo-panel">
      {view === "diff" ? <FileDiff /> : <CommitHistory />}
    </section>
  );
}
