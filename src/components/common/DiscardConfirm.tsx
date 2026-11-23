import { useState, type ReactNode } from "react";
import { useAppContext } from "../../context/AppContext";
import ActionModal from "./ActionModal";

/** Something about to be thrown away for good, and how to do it. */
export interface DiscardRequest {
  /** The modal's title, e.g. "Discard changes to a.txt?". */
  title: string;
  /** What will be lost, e.g. "All changes to <code>a.txt</code>". */
  what: ReactNode;
  /** The confirm button's label. */
  confirmLabel: string;
  /** Does the discarding; called once confirmed (at once when the warning is off). */
  run: () => void;
}

/**
 * Asks before anything is discarded for good, with a tick box to stop
 * asking until Gitizen is closed (that choice is never saved). Render
 * `discardDialog` and call `confirmDiscard` instead of discarding directly.
 */
export function useDiscardConfirmation(): {
  confirmDiscard: (request: DiscardRequest) => void;
  discardDialog: React.JSX.Element | null;
} {
  const { skipDiscardWarning, setSkipDiscardWarning } = useAppContext();
  const [pending, setPending] = useState<DiscardRequest | null>(null);
  const [dontAsk, setDontAsk] = useState(false);

  const confirmDiscard = (request: DiscardRequest): void => {
    if (skipDiscardWarning) request.run();
    else {
      setDontAsk(false);
      setPending(request);
    }
  };

  const discardDialog = pending && (
    <ActionModal
      title={pending.title}
      onDismiss={() => setPending(null)}
      actions={[
        {
          label: pending.confirmLabel,
          primary: true,
          onClick: () => {
            if (dontAsk) setSkipDiscardWarning(true);
            setPending(null);
            pending.run();
          },
        },
      ]}
    >
      <p>{pending.what} will be discarded.</p>
      <p>
        <b>This is permanent.</b> The changes aren&apos;t kept anywhere, so the data will be
        lost and can&apos;t be brought back.
      </p>
      <label className="discard-dont-ask">
        <input
          type="checkbox"
          checked={dontAsk}
          onChange={(event) => setDontAsk(event.target.checked)}
        />
        Don&apos;t warn me again until Gitizen is closed
      </label>
    </ActionModal>
  );

  return { confirmDiscard, discardDialog };
}
