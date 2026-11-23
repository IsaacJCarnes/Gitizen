import "./ConflictEditor.css";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ConflictVersions } from "../../../shared/gitTypes";
import { gitizen } from "../../api/gitizen";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import {
  buildOutput,
  lineKey,
  parseConflict,
  type Side,
} from "../../utils/conflictText";
import { pluralize } from "../../utils/format";
import AiCommandModal from "../RepoSidebar/AiCommandModal";
import EditorCommandModal from "./EditorCommandModal";

/** Unchanged stretches longer than this are folded to their ends. */
const FOLD_OVER = 8;
/** Lines kept visible at each end of a folded stretch. */
const FOLD_CONTEXT = 3;

/** Line endings don't matter when comparing the editor's text with the file's. */
const sameText = (a: string | null, b: string | null): boolean =>
  (a ?? "").replace(/\r\n/g, "\n") === (b ?? "").replace(/\r\n/g, "\n");

interface ConflictEditorProps {
  /** The conflicted file to edit. Remount (key) per file, so state starts fresh. */
  path: string;
}

/**
 * The conflict editor in the main panel. The top shows each conflict with
 * the current branch's lines beside the incoming lines, each line with a
 * checkbox; ticking adds it to the output below, in the order lines are
 * ticked (so an incoming line ticked first lands above a current one). The output can also be edited by hand or
 * filled by the AI command, and Save writes it to the file. Marking the file
 * resolved happens in the sidebar.
 */
export default function ConflictEditor({
  path,
}: ConflictEditorProps): React.JSX.Element {
  const { setView } = useAppContext();
  const {
    conflicts,
    saveConflictResolution,
    openInMergeTool,
    resolveConflict,
    reportError,
  } = useGitOperationsContext();
  const [versions, setVersions] = useState<ConflictVersions | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [output, setOutput] = useState("");
  // True once the output no longer matches the ticked lines (typed in, the
  // AI's answer, or a saved file loaded back).
  const [handEdited, setHandEdited] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState<"ai" | "save" | "tool" | null>(null);
  // null until loaded from the backend; "" means not set up.
  const [aiCommand, setAiCommand] = useState<string | null>(null);
  const [editorCommand, setEditorCommand] = useState<string | null>(null);
  const [settingUpAi, setSettingUpAi] = useState(false);
  const [changingTool, setChangingTool] = useState(false);
  // The working file's text the output was last synced with, to tell our
  // own saves apart from changes made outside (an external tool).
  const syncedWorking = useRef<string | null | undefined>(undefined);

  const file = conflicts.files.find((candidate) => candidate.path === path);
  const parsed = useMemo(
    () => parseConflict(versions?.merged ?? ""),
    [versions?.merged],
  );
  const conflictCount = parsed.segments.filter(
    (segment) => segment.kind === "conflict",
  ).length;

  useEffect(() => {
    gitizen.aiCommitCommand().then(setAiCommand, () => setAiCommand(""));
    gitizen.editorCommand().then(setEditorCommand, () => setEditorCommand(""));
  }, []);

  // (Re)load after every refresh while the file is still conflicted. The
  // output is replaced only when the file changed since we last synced with
  // it: on first load, or after it was edited outside Gitizen.
  useEffect(() => {
    if (!file) return;
    let active = true;
    gitizen.conflictVersions(path).then((next) => {
      if (!active) return;
      setVersions(next);
      if (
        syncedWorking.current !== undefined &&
        sameText(syncedWorking.current, next.working)
      )
        return;
      syncedWorking.current = next.working;
      const saved = next.working !== null && !/^<{7}( |$)/m.test(next.working);
      // A resolution saved earlier is shown as it is; otherwise start from
      // the unconflicted lines with nothing picked.
      setPicked(new Set());
      setOutput(
        saved
          ? next.working!.replace(/\r\n/g, "\n")
          : buildOutput(parseConflict(next.merged), new Set()),
      );
      setHandEdited(saved);
    }, reportError);
    return () => {
      active = false;
    };
  }, [path, file, conflicts, reportError]);

  const pickLines = (next: ReadonlySet<string>): void => {
    setPicked(next);
    setOutput(buildOutput(parsed, next));
    setHandEdited(false);
  };

  const toggle = (key: string): void => {
    // Adding goes to the end of the Set, so the output follows click order.
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    pickLines(next);
  };

  /** Ticks every line of one side in every conflict, and nothing of the other. */
  const pickAll = (side: Side): void => {
    const next = new Set<string>();
    let index = 0;
    for (const segment of parsed.segments) {
      if (segment.kind !== "conflict") continue;
      segment[side].forEach((_, line) => next.add(lineKey(index, side, line)));
      index++;
    }
    pickLines(next);
  };

  const save = async (): Promise<void> => {
    setBusy("save");
    // Remember what we wrote, so the reload after saving keeps the picks.
    const previous = syncedWorking.current;
    syncedWorking.current = output;
    const ok = await saveConflictResolution(path, output);
    if (!ok) syncedWorking.current = previous;
    setBusy(null);
  };

  const resolveWithAi = async (): Promise<void> => {
    setBusy("ai");
    try {
      const answer = await gitizen.aiResolveConflict(path);
      setPicked(new Set());
      setOutput(answer);
      setHandEdited(true);
    } catch (error) {
      reportError(error);
    }
    setBusy(null);
  };

  const saveAiCommand = (command: string): void => {
    setSettingUpAi(false);
    gitizen.setAiCommitCommand(command).then((saved) => {
      setAiCommand(saved);
      //if (saved) void resolveWithAi();
    }, reportError);
  };

  const openTool = async (): Promise<void> => {
    setBusy("tool");
    await openInMergeTool(path);
    setBusy(null);
  };

  const header = (
    <header className="diff-header conflict-editor-header">
      <button onClick={() => setView("history")}>← History</button>
      <span className="path" title={path}>
        {path}
      </span>
      <small>{file ? pluralize(conflictCount, "conflict") : "Resolved"}</small>
      {file && versions && !versions.binary && (
        <span className="conflict-editor-tools">
          <span className="conflict-tool">
            <button
              disabled={
                busy !== null || aiCommand === null || conflictCount === 0
              }
              title={
                aiCommand
                  ? "Ask AI to resolve the conflict"
                  : "Set up an AI command to resolve conflicts"
              }
              onClick={() =>
                aiCommand ? void resolveWithAi() : setSettingUpAi(true)
              }
            >
              {busy === "ai" ? (
                <>
                  <span className="conflict-spinner" aria-hidden="true" />{" "}
                  Resolving…
                </>
              ) : (
                "Resolve with AI"
              )}
            </button>
            <button
              aria-label="Resolve with AI settings"
              title="Resolve with AI settings"
              disabled={busy !== null}
              onClick={() => setSettingUpAi(true)}
            >
              &#9881;
            </button>
          </span>
          <span className="conflict-tool">
            <button
              disabled={busy !== null}
              title={
                editorCommand
                  ? `Open with ${editorCommand}`
                  : "Open in git's merge tool, or the text editor if none is configured"
              }
              onClick={() => void openTool()}
            >
              {busy === "tool"
                ? "Waiting for merge tool…"
                : "Open in merge tool"}
            </button>
            <button
              aria-label="External merge tool settings"
              title="External merge tool settings"
              disabled={busy !== null || editorCommand === null}
              onClick={() => setChangingTool(true)}
            >
              &#9881;
            </button>
          </span>
          <button
            className="primary"
            disabled={busy !== null}
            title="Write the output to the file (Mark resolved in the sidebar stages it)"
            onClick={() => void save()}
          >
            {busy === "save" ? "Saving…" : "Save"}
          </button>
        </span>
      )}
    </header>
  );

  const modals = (
    <>
      {settingUpAi && (
        <AiCommandModal
          initialCommand={aiCommand ?? ""}
          onSave={saveAiCommand}
          onDismiss={() => setSettingUpAi(false)}
        />
      )}
      {changingTool && (
        <EditorCommandModal
          initialCommand={editorCommand ?? ""}
          onSave={(command) => {
            setChangingTool(false);
            gitizen
              .setEditorCommand(command)
              .then(setEditorCommand, reportError);
          }}
          onDismiss={() => setChangingTool(false)}
        />
      )}
    </>
  );

  if (!file) {
    return (
      <div className="conflict-editor">
        {header}
        <p className="placeholder">
          This file is resolved. Pick another conflicted file in the sidebar.
        </p>
      </div>
    );
  }
  if (!versions) {
    return (
      <div className="conflict-editor">
        {header}
        <p className="placeholder">Loading…</p>
      </div>
    );
  }
  if (versions.binary) {
    return (
      <div className="conflict-editor">
        {header}
        <div className="conflict-binary">
          <p>
            This is a binary file, so its lines can&apos;t be picked. Keep one
            whole version:
          </p>
          <button onClick={() => void resolveConflict(path, "ours")}>
            Keep current version
          </button>
          <button onClick={() => void resolveConflict(path, "theirs")}>
            Use incoming version
          </button>
        </div>
      </div>
    );
  }

  let conflictIndex = 0;
  return (
    <div className="conflict-editor">
      {header}
      <div className="conflict-sides">
        <div className="conflict-columns-head">
          <span>Current{conflicts.current && ` (${conflicts.current})`}</span>
          <span>Incoming{conflicts.incoming && ` (${conflicts.incoming})`}</span>
        </div>
        {parsed.segments.map((segment, segmentIndex) => {
          if (segment.kind === "common") {
            const folded =
              segment.lines.length > FOLD_OVER && !expanded.has(segmentIndex);
            const shown = folded
              ? [
                  segment.lines.slice(0, FOLD_CONTEXT),
                  segment.lines.slice(-FOLD_CONTEXT),
                ]
              : [segment.lines];
            return (
              <div key={segmentIndex} className="conflict-common">
                {shown.map((lines, part) => (
                  <Fragment key={part}>
                    {part === 1 && (
                      <button
                        className="conflict-fold"
                        onClick={() =>
                          setExpanded(new Set(expanded).add(segmentIndex))
                        }
                      >
                        ⋯{" "}
                        {pluralize(
                          segment.lines.length - 2 * FOLD_CONTEXT,
                          "unchanged line",
                        )}
                      </button>
                    )}
                    {lines.map((line, i) => (
                      <div key={i} className="conflict-line">
                        <span className="code">{line || " "}</span>
                      </div>
                    ))}
                  </Fragment>
                ))}
              </div>
            );
          }
          const index = conflictIndex++;
          const side = (name: Side) => {
            const keys = segment[name].map((_, line) =>
              lineKey(index, name, line),
            );
            return (
              <div className={`conflict-side ${name}`}>
                {keys.length === 0 && (
                  <div className="conflict-side-empty">No lines</div>
                )}
                {segment[name].map((line, i) => (
                  <label
                    key={i}
                    className={`conflict-line${picked.has(keys[i]) ? " picked" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={picked.has(keys[i])}
                      onChange={() => toggle(keys[i])}
                    />
                    <span className="code">{line || " "}</span>
                  </label>
                ))}
              </div>
            );
          };
          return (
            <div key={segmentIndex} className="conflict-block">
              {side("current")}
              {side("incoming")}
            </div>
          );
        })}
      </div>
      <section className="conflict-output">
        <div className="conflict-output-head">
          <b>Output</b>
          <small>
            {handEdited
              ? "Edited. Ticking lines rebuilds the output and replaces these edits."
              : "Tick lines above to add them. You can also type here."}
          </small>
          <span className="conflict-output-picks">
            <button onClick={() => pickAll("current")}>Take all current</button>
            <button onClick={() => pickAll("incoming")}>
              Take all incoming
            </button>
          </span>
        </div>
        <textarea
          aria-label="Resolved file"
          spellCheck={false}
          value={output}
          readOnly={busy === "ai"}
          onChange={(event) => {
            setOutput(event.target.value);
            setHandEdited(true);
          }}
        />
      </section>
      {modals}
    </div>
  );
}
