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
