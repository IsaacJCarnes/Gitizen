import { useState } from "react";
import { joinMessage } from "../../utils/format";

interface MessageFieldsOptions {
  /** The description field's label. */
  descriptionLabel?: string;
  /** The description box's height in lines. */
  rows?: number;
}

/**
 * Summary and description fields for a dialog that writes a commit
 * message (squashing, squash merging), like the commit form's. Returns the
 * fields to put in the form, the message they make, and whether it has the
 * summary it needs.
 */
export function useMessageFields(
  initialSummary: string,
  initialDescription = "",
  { descriptionLabel = "Description (optional)", rows = 4 }: MessageFieldsOptions = {},
): { fields: React.JSX.Element; message: string; ready: boolean } {
  const [summary, setSummary] = useState(initialSummary);
  const [description, setDescription] = useState(initialDescription);
  const fields = (
    <>
      <label>
        Summary
        <input value={summary} autoFocus onChange={(event) => setSummary(event.target.value)} />
      </label>
      <label>
        {descriptionLabel}
        <textarea rows={rows} value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
    </>
  );
  return { fields, message: joinMessage(summary, description), ready: summary.trim() !== "" };
}
