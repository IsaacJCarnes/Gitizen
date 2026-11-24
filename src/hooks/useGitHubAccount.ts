import { useCallback, useEffect, useMemo, useState } from "react";
import type { GitHubAccount } from "../../shared/gitTypes";
import { gitizen } from "../api/gitizen";

/** The GitHub sign-in, and ways to change it. */
export interface GitHubAccountState {
  /** The signed-in account, or null. */
  account: GitHubAccount | null;
  /** True until the saved sign-in (if any) has been looked up at startup. */
  loading: boolean;
  /** Signs in through git's credential helper. Resolves to true once signed in. */
  signIn: () => Promise<boolean>;
  /** Signs in with a personal access token. Resolves to true once signed in. */
  signInWithToken: (token: string) => Promise<boolean>;
  signOut: () => Promise<boolean>;
}

/**
 * Keeps track of the GitHub account. At startup it picks up a sign-in git's
 * credential helper already has; failures show through `reportError`.
 */
export function useGitHubAccount(reportError: (caught: unknown) => void): GitHubAccountState {
  const [account, setAccount] = useState<GitHubAccount | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    gitizen
      .gitHubAccount()
      .then((found) => !cancelled && setAccount(found))
      // Not being able to look it up only means showing "Sign in".
      .catch(console.error)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const signInWith = useCallback(
    async (signingIn: Promise<GitHubAccount>): Promise<boolean> => {
      try {
        setAccount(await signingIn);
        return true;
      } catch (caught) {
        reportError(caught);
        return false;
      }
    },
    [reportError],
  );

  const signIn = useCallback(() => signInWith(gitizen.gitHubSignIn()), [signInWith]);
  const signInWithToken = useCallback(
    (token: string) => signInWith(gitizen.gitHubSignInWithToken(token)),
    [signInWith],
  );

  const signOut = useCallback(async (): Promise<boolean> => {
    try {
      await gitizen.gitHubSignOut();
      setAccount(null);
      return true;
    } catch (caught) {
      reportError(caught);
      return false;
    }
  }, [reportError]);

  return useMemo(
    () => ({ account, loading, signIn, signInWithToken, signOut }),
    [account, loading, signIn, signInWithToken, signOut],
  );
}
