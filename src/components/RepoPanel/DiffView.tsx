interface DiffViewProps {
  diff: string;
}

function lineClass(line: string): string {
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  if (line.startsWith("@@")) return "hunk";
  return "";
}

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
