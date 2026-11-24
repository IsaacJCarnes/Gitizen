import "./GitHub.css";
import { useState } from "react";
import { useAppContext } from "../../context/AppContext";
import { gitizen } from "../../api/gitizen";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import ConfirmModal from "../common/ConfirmModal";
import ContextMenu from "../common/ContextMenu";
import SignInModal from "./SignInModal";

/**
 * The GitHub account in the header and on the start screen: "Sign in to
 * GitHub" when signed out; the avatar and login when signed in, opening a
 * menu with the profile and Sign out.
 */
export default function AccountButton(): React.JSX.Element | null {
  const { github } = useAppContext();
  const { reportError } = useGitOperationsContext();
  // Where the account menu is open (below the button), or null.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { account } = github;
  if (github.loading) return null;

  if (!account) {
    return (
      <>
        <button className="account-button" onClick={() => setSigningIn(true)}>
          Sign in to GitHub
        </button>
        {signingIn && <SignInModal onDismiss={() => setSigningIn(false)} />}
      </>
    );
  }

  const openProfile = (): void => {
    gitizen.openInBrowser(`https://github.com/${account.login}`).catch(reportError);
  };

  return (
    <>
      <button
        className="account-button"
        title={`Signed in to GitHub as ${account.login}`}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setMenu({ x: box.left, y: box.bottom + 4 });
        }}
      >
        {account.avatarUrl && <img className="account-avatar" src={account.avatarUrl} alt="" />}
        {account.login}
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          entries={[
            { label: account.name ? `${account.name} (${account.login})` : account.login, disabled: true },
            "separator",
            { label: "Open profile on GitHub", onSelect: openProfile },
            { label: "Sign out…", onSelect: () => setSigningOut(true) },
          ]}
        />
      )}
      {signingOut && (
        <ConfirmModal
          title="Sign out of GitHub"
          confirmLabel="Sign out"
          onConfirm={() => void github.signOut()}
          onDismiss={() => setSigningOut(false)}
        >
          <p>
            This also removes the GitHub sign-in from git's credential manager, so git asks you to
            sign in again the next time it pushes or pulls from GitHub.
          </p>
        </ConfirmModal>
      )}
    </>
  );
}
