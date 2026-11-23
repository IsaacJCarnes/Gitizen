import { useState, type ReactNode } from "react";
import ActionModal from "./ActionModal";

interface FormModalProps {
  title: string;
  /** The submit button's label, and its label while `onSubmit` runs. */
  submitLabel: string;
  workingLabel: string;
  /** False while the form is incomplete, which disables submitting. */
  ready: boolean;
  /** Does the work; the modal closes once it resolves to true. */
  onSubmit: () => Promise<boolean>;
  onDismiss: () => void;
  /** Class of the `<form>`, for laying out its fields. */
  className?: string;
  children: ReactNode;
}

/**
 * A modal holding a form with one submit button (Enter in any field
 * submits too). It shows the working label while `onSubmit` runs and closes
 * only if that worked: on failure the error modal explains, and the form
 * stays open to try again.
 */
export default function FormModal({
  title,
  submitLabel,
  workingLabel,
  ready,
  onSubmit,
  onDismiss,
  className,
  children,
}: FormModalProps): React.JSX.Element {
  const [working, setWorking] = useState(false);

  const submit = async (): Promise<void> => {
    if (!ready || working) return;
    setWorking(true);
    const ok = await onSubmit();
    setWorking(false);
    if (ok) onDismiss();
  };

  return (
    <ActionModal
      title={title}
      onDismiss={onDismiss}
      actions={[
        {
          label: working ? workingLabel : submitLabel,
          primary: true,
          disabled: !ready || working,
          onClick: () => void submit(),
        },
      ]}
    >
      <form
        className={className}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {children}
        {/* Lets Enter in any field submit the form. */}
        <button type="submit" hidden />
      </form>
    </ActionModal>
  );
}
