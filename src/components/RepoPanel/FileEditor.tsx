import { useState } from "react";
import { useGitOperationsContext } from "../../context/GitOperationsContext";

interface FileEditorProps {
  path: string;
  /** The working-tree file's text when editing started. */
  initialText: string;
  /** Called after saving (with true) or cancelling (false). */
  onDone: (saved: boolean) => void;
}

/**
 * Edits a working-tree file in the main panel. Save writes it back (with
 * the file's own line endings), after which it is listed as changed;
 * Ctrl+S saves too. Cancel leaves the file as it was.
 */
export default function FileEditor({ path, initialText, onDone }: FileEditorProps): React.JSX.Element {
  const { saveWorkingFile } = useGitOperationsContext();
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const changed = text !== initialText;

  const save = async (): Promise<void> => {
    if (!changed || saving) return;
    setSaving(true);
    const saved = await saveWorkingFile(path, text);
    setSaving(false);
    if (saved) onDone(true);
  };

  return (
    <div className="file-editor">
      <div className="file-editor-bar">
        <small>
          {changed ? "Edited. Save to write it to the working directory." : "Editing the working directory's copy."}
        </small>
        <button onClick={() => onDone(false)} disabled={saving}>
          Cancel
        </button>
        <button className="primary" onClick={() => void save()} disabled={!changed || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <textarea
        aria-label={`Contents of ${path}`}
        spellCheck={false}
        autoFocus
        value={text}
        readOnly={saving}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "s" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void save();
          }
        }}
      />
    </div>
  );
}
