import { useState } from "react";
import SignInModal from "./SignInModal";

/**
 * For a modal that needs the GitHub sign-in (clone, publish): `prompt(why)`
 * is a hint with a "Sign in to GitHub" button, and once that is clicked,
 * `signInModal` is the sign-in modal to show in the modal's place until it
 * closes. Null otherwise.
 */
export function useSignInPrompt(): {
  signInModal: React.JSX.Element | null;
  prompt: (why: string) => React.JSX.Element;
} {
  const [signingIn, setSigningIn] = useState(false);
  return {
    signInModal: signingIn ? <SignInModal onDismiss={() => setSigningIn(false)} /> : null,
    prompt: (why) => (
      <p className="hint">
        {why}{" "}
        <button type="button" onClick={() => setSigningIn(true)}>
          Sign in to GitHub
        </button>
      </p>
    ),
  };
}
