/** The state of a checkbox that stands for several things at once. */

/** "mixed" renders as the browser's indeterminate (dash) state. */
export type CheckState = boolean | "mixed";

/** Ticked when every state is (and there is at least one), clear when none is, otherwise mixed. */
export function combineStates(states: CheckState[]): CheckState {
  if (states.length > 0 && states.every((state) => state === true)) return true;
  if (states.every((state) => state === false)) return false;
  return "mixed";
}
