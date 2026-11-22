import "./EmptyRepositoryView.css";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { baseName } from "../../utils/format";

/** Start screen shown until a repository is opened, with recent repositories to reopen. */
export default function EmptyRepositoryView(): React.JSX.Element {
  const { openRepository, openRepositoryAt } = useGitOperationsContext();
  const { recentRepos } = useAppContext();

  return (
    <div className="empty-repository">
      <h1>Gitizen</h1>
      <p>Open a folder that contains a git repository to see its changes and history.</p>
      <button className="primary" onClick={openRepository}>Open repository</button>
      {recentRepos.length > 0 && (
        <section className="recent-repositories">
          <h2>Recent</h2>
          <ul>
            {recentRepos.map((path) => (
              <li key={path}>
                <button title={path} onClick={() => openRepositoryAt(path)}>
                  <span className="name">{baseName(path)}</span>
                  <span className="path">{path}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
