import "./ActionModal.css";
import { useEffect, useId, useRef, type ReactNode } from "react";

/** A button in the modal's footer besides the dismiss button. */
export interface ModalAction {
  label: string;
  onClick: () => void;
  /** Styles it as the main choice and gives it focus when the modal opens. */
  primary?: boolean;
}

interface ActionModalProps {
  title: string;
  children: ReactNode;
  actions?: ModalAction[];
  /** Called by the dismiss button, Escape, or a click on the backdrop. */
  onDismiss: () => void;
  /** Defaults to "Cancel" when there are actions, otherwise "OK". */
  dismissLabel?: string;
}

/**
 * A modal dialog built on the native `<dialog>`, so focus stays inside it and
 * Escape closes it. Mount it while it should be open; unmounting closes it.
 */
export default function ActionModal({
  title,
  children,
  actions = [],
  onDismiss,
  dismissLabel,
}: ActionModalProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLButtonElement>("button.primary")?.focus();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="action-modal"
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape: let React decide by unmounting instead of the browser closing it.
        event.preventDefault();
        onDismiss();
      }}
      onClick={(event) => {
        // A click on the dialog element itself (not its content) is the backdrop.
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div className="action-modal-content">
        <h2 id={titleId}>{title}</h2>
        <div className="action-modal-body">{children}</div>
        <footer>
          <button onClick={onDismiss}>
            {dismissLabel ?? (actions.length > 0 ? "Cancel" : "OK")}
          </button>
          {actions.map((action) => (
            <button
              key={action.label}
              className={action.primary ? "primary" : undefined}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </footer>
      </div>
    </dialog>
  );
}
