import type { ReactNode } from "react";
import ActionModal from "./ActionModal";

interface ConfirmModalProps {
  title: string;
  /** The confirm button's label, e.g. "Abort merge". */
  confirmLabel: string;
  /** Called once confirmed, after `onDismiss` has closed the modal. */
  onConfirm: () => void;
  onDismiss: () => void;
  /** What will happen, and why it is worth asking. */
  children: ReactNode;
}

/** Asks before doing something, with Cancel and one confirm button. */
export default function ConfirmModal({
  title,
  confirmLabel,
  onConfirm,
  onDismiss,
  children,
}: ConfirmModalProps): React.JSX.Element {
  return (
    <ActionModal
      title={title}
      onDismiss={onDismiss}
      actions={[
        {
          label: confirmLabel,
          primary: true,
          onClick: () => {
            onDismiss();
            onConfirm();
          },
        },
      ]}
    >
      {children}
    </ActionModal>
  );
}
