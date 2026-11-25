/** Loading data from the backend inside React effects. */

/**
 * Runs `request` and passes its result to `onResult` (or its error to
 * `onError`) unless the returned cleanup ran first. Use as an effect's body
 * so a slow response for an old selection can't overwrite a newer one.
 */
export function loadUnlessCancelled<T>(
  request: Promise<T>,
  onResult: (value: T) => void,
  onError: (error: unknown) => void,
): () => void {
  let active = true;
  request
    .then((value) => {
      if (active) onResult(value);
    })
    .catch((error: unknown) => {
      if (active) onError(error);
    });
  return () => {
    active = false;
  };
}

/**
 * Like `loadUnlessCancelled`, for state that has an empty value: sets
 * `empty` right away when there is nothing to load, or when loading fails
 * (which is passed to `onError` too, when given).
 */
export function loadOrReset<T>(
  request: Promise<T> | null | undefined,
  set: (value: T) => void,
  empty: T,
  onError?: (error: unknown) => void,
): (() => void) | undefined {
  if (!request) {
    set(empty);
    return undefined;
  }
  return loadUnlessCancelled(request, set, (error) => {
    set(empty);
    onError?.(error);
  });
}

/**
 * Runs `work`, resolving to true once it is done. On failure the error goes
 * to `onError` and it resolves to false, so callers can tell without a
 * try/catch of their own.
 */
export async function attempt(work: () => Promise<unknown>, onError: (error: unknown) => void): Promise<boolean> {
  try {
    await work();
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
}
