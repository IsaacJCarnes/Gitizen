import "./DiffView.css";

interface DiffViewProps {
  /** Unified diff text as returned by git. */
  diff: string;
}

/** CSS class that colours one unified-diff line. */
function lineClass(line: string): string {
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  if (line.startsWith("@@")) return "hunk";
  return "";
}

/** Renders a unified diff with added, removed and hunk-header lines highlighted. */
export default function DiffView({ diff }: DiffViewProps): React.JSX.Element {
  if (!diff) {
    return <p className="placeholder">No changes to show.</p>;
  }

  return (
    <pre className="diff">
      {diff.split("\n").map((line, index) => (
        <div key={index} className={lineClass(line)}>
          {line || " "}
        </div>
      ))}
    </pre>
  );
}
