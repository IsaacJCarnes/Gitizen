import "./GitizenView.css";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import EmptyRepositoryView from "../../components/EmptyRepositoryView/EmptyRepositoryView";
import RepositoryHeader from "../../components/RepositoryHeader/RepositoryHeader";
import RepoPanel from "../../components/RepoPanel/RepoPanel";
import RepoSidebar from "../../components/RepoSidebar/RepoSidebar";

/**
 * Top-level page. Shows the start screen until a repository is open, then
 * the header, an error bar if needed, and the sidebar + main panel layout.
 */
export default function GitizenView(): React.JSX.Element {
  const { repo, error } = useGitOperationsContext();
  if (!repo) {
    return <EmptyRepositoryView />;
  }

  return (
    <div className="gitizen-view">
      <RepositoryHeader />
      {error && <div className="error bar">{error}</div>}
      <main>
        <RepoSidebar />
        <RepoPanel />
      </main>
    </div>
  );
}
