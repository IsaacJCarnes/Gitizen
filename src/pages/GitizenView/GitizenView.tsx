import "./GitizenView.css";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import EmptyRepositoryView from "../../components/EmptyRepositoryView/EmptyRepositoryView";
import RepositoryHeader from "../../components/RepositoryHeader/RepositoryHeader";
import RepoPanel from "../../components/RepoPanel/RepoPanel";
import RepoSidebar from "../../components/RepoSidebar/RepoSidebar";
import ErrorModal from "../../components/ErrorModal/ErrorModal";
import SwitchBranchModal from "../../components/Branches/SwitchBranchModal";

/**
 * Top-level page. Shows the start screen until a repository is open, then
 * the header and the sidebar + main panel layout. The error modal sits on
 * top of either one when an operation fails.
 */
export default function GitizenView(): React.JSX.Element {
  const { repo } = useGitOperationsContext();

  return (
    <>
      {repo ? (
        <div className="gitizen-view">
          <RepositoryHeader />
          <main>
            <RepoSidebar />
            <RepoPanel />
          </main>
          <SwitchBranchModal />
        </div>
      ) : (
        <EmptyRepositoryView />
      )}
      <ErrorModal />
    </>
  );
}
