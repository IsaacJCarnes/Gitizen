/** Turning whatever a failed call threw into something the error modal can show. */
import type { OpenRepositoryError } from "../../shared/ipc";

/**
 * An error waiting in the error modal. It has the same shape as the
 * backend's `OpenRepositoryError`: "notARepository" offers to create a
 * repository at `path`, "failed" just shows the message.
 */
export type AppError = OpenRepositoryError;

/** True for the `{ kind, message }` objects the backend rejects with when opening a repository. */
function isOpenRepositoryError(value: unknown): value is OpenRepositoryError {
  if (typeof value !== "object" || value === null) return false;
  const { kind, message, path } = value as Record<string, unknown>;
  if (typeof message !== "string") return false;
  return kind === "failed" || (kind === "notARepository" && typeof path === "string");
}

/** Normalises anything thrown (backend error object, Error, IPC error string) into an `AppError`. */
export function toAppError(caught: unknown): AppError {
  if (isOpenRepositoryError(caught)) return caught;
  const message = caught instanceof Error ? caught.message : String(caught);
  return { kind: "failed", message };
}
