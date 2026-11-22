import { useEffect, useRef } from "react";
import type { CheckState } from "../../utils/checkState";

interface TriStateCheckboxProps {
  state: CheckState;
  onChange: () => void;
  /** Accessible label and tooltip. */
  label: string;
  disabled?: boolean;
}

/**
 * Checkbox that can also show a mixed state. `indeterminate` is a DOM
 * property with no HTML attribute, so it is set through a ref.
 */
export default function TriStateCheckbox({
  state,
  onChange,
  label,
  disabled,
}: TriStateCheckboxProps): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "mixed";
  }, [state]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className="stage-check"
      checked={state === true}
      onChange={onChange}
      aria-label={label}
      aria-checked={state === "mixed" ? "mixed" : state}
      title={label}
      disabled={disabled}
    />
  );
}
