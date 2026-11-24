import "./EmptyRepositoryView.css";
import { useState } from "react";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { baseName } from "../../utils/format";
import AccountButton from "../GitHub/AccountButton";
import CloneModal from "../Clone/CloneModal";

/** Start screen shown until a repository is opened: open or clone one, or reopen a recent one. */
export default function EmptyRepositoryView(): React.JSX.Element {
  const { openRepository, openRepositoryAt } = useGitOperationsContext();
  const { recentRepos } = useAppContext();
  const [cloning, setCloning] = useState(false);

  return (
    <div className="empty-repository">
      <div className="empty-repository-account">
        <AccountButton />
      </div>
      <h1>Gitizen</h1>
      <p>Open a folder that contains a git repository to see its changes and history.</p>
      <div className="empty-repository-actions">
        <button className="primary" onClick={openRepository}>Open repository</button>
        <button onClick={() => setCloning(true)}>Clone repository</button>
      </div>
      {cloning && <CloneModal onDismiss={() => setCloning(false)} />}
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
