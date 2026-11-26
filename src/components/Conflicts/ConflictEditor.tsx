import "./ConflictEditor.css";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ConflictVersions, SavedCommandKind } from "../../../shared/gitTypes";
import { gitizen } from "../../api/gitizen";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { useSavedCommand } from "../../hooks/useSavedCommand";
import {
  buildOutput,
  hasConflictMarkers,
  lineKey,
  parseConflict,
  sideKeys,
  type ConflictSegment,
  type Side,
} from "../../utils/conflictText";
import { pluralize } from "../../utils/format";
import { loadUnlessCancelled } from "../../utils/load";
import CommandModal from "../common/CommandModal";

/** Unchanged stretches longer than this are folded to their ends. */
const FOLD_OVER = 8;
/** Lines kept visible at each end of a folded stretch. */
const FOLD_CONTEXT = 3;

/** The editor works in "\n"; saving puts the file's own line endings back. */
const toLf = (text: string): string => text.replace(/\r\n/g, "\n");

/** Line endings don't matter when comparing the editor's text with the file's. */
const sameText = (a: string | null, b: string | null): boolean =>
  toLf(a ?? "") === toLf(b ?? "");

interface ConflictEditorProps {
  /** The conflicted file to edit. Remount (key) per file, so state starts fresh. */
  path: string;
}

/**
 * The conflict editor in the main panel. The top shows each conflict with
 * the current branch's lines beside the incoming lines, each line with a
 * checkbox; ticking adds it to the output below, in the order lines are
 * ticked (so an incoming line ticked first lands above a current one). The
 * output can also be edited by hand or filled by the AI command, and Save
 * writes it to the file. When the saved output has no conflict markers
 * left, the file is marked resolved too (staged), and the next conflicted
 * file opens; otherwise Mark resolved in the sidebar does that.
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
    setSelectedConflict,
    reportError,
  } = useGitOperationsContext();
  const ai = useSavedCommand("aiResolve");
  const editor = useSavedCommand("editor");
  const [versions, setVersions] = useState<ConflictVersions | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [output, setOutput] = useState("");
  // True once the output no longer matches the ticked lines (typed in, the
  // AI's answer, or a saved file loaded back).
  const [handEdited, setHandEdited] = useState(false);
  const [busy, setBusy] = useState<"ai" | "save" | "tool" | null>(null);
  // The command being set up in its modal.
  const [modal, setModal] = useState<SavedCommandKind | null>(null);
  // The working file's text the output was last synced with, to tell our
  // own saves apart from changes made outside (an external tool).
  // undefined until the first load.
  const syncedWorking = useRef<string | null | undefined>(undefined);

  const file = conflicts.files.find((candidate) => candidate.path === path);
  const parsed = useMemo(
    () => parseConflict(versions?.merged ?? ""),
    [versions?.merged],
  );
  const conflictCount = parsed.segments.filter(
    (segment) => segment.kind === "conflict",
  ).length;

  // (Re)load after every refresh while the file is still conflicted. The
  // output is replaced only when the file changed since we last synced with
  // it: on first load, or after it was edited outside Gitizen.
  useEffect(() => {
    if (!file) return;
    return loadUnlessCancelled(gitizen.conflictVersions(path), (next) => {
      setVersions(next);
      if (
        syncedWorking.current !== undefined &&
        sameText(syncedWorking.current, next.working)
      )
        return;
      syncedWorking.current = next.working;
      const working = next.working;
      // A resolution saved earlier is shown as it is; otherwise start from
      // the unconflicted lines with nothing picked.
      const saved = working !== null && !hasConflictMarkers(working);
      setPicked(new Set());
      setOutput(
        saved ? toLf(working) : buildOutput(parseConflict(next.merged), new Set()),
      );
      setHandEdited(saved);
    }, (error) => {
      // Saving and staging the file races the reload a refresh starts: by
      // the time it runs the file may be resolved, which is no error.
      void gitizen
        .repositoryState()
        .then(({ conflicts: now }) => {
          if (now.files.some((candidate) => candidate.path === path)) reportError(error);
        })
        .catch(() => undefined);
    });
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

  const save = async (): Promise<void> => {
    setBusy("save");
    // Remember what we wrote, so the reload after saving keeps the picks.
    const previous = syncedWorking.current;
    syncedWorking.current = output;
    const resolved = !hasConflictMarkers(output);
    let saved: boolean;
    if (resolved) {
      // Saved and staged in one go (one refresh, after staging), so nothing
      // reloads the file in between.
      saved = await gitizen.saveConflictResolution(path, output).then(
        () => true,
        (error: unknown) => {
          reportError(error);
          return false;
        },
      );
    } else {
      saved = await saveConflictResolution(path, output);
    }
    if (!saved) {
      syncedWorking.current = previous;
      setBusy(null);
      return;
    }
    // Nothing left to resolve: stage it now, and go on to the next file.
    if (resolved && (await resolveConflict(path, "asIs"))) {
      const next = conflicts.files.find((candidate) => candidate.path !== path);
      if (next) setSelectedConflict(next.path);
    }
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
          <ToolWithSettings
            disabled={busy !== null || ai.command === null || conflictCount === 0}
            title={
              ai.command
                ? "Ask AI to resolve the conflict"
                : "Set up an AI command to resolve conflicts"
            }
            onClick={() => (ai.command ? void resolveWithAi() : setModal("aiResolve"))}
            settingsLabel="Resolve with AI settings"
            settingsDisabled={busy !== null}
            onSettings={() => setModal("aiResolve")}
          >
            {busy === "ai" ? (
              <>
                <span className="spinner" aria-hidden="true" /> Resolving…
              </>
            ) : (
              "Resolve with AI"
            )}
          </ToolWithSettings>
          <ToolWithSettings
            disabled={busy !== null}
            title={
              editor.command
                ? `Open with ${editor.command}`
                : "Open in git's merge tool, or the text editor if none is configured"
            }
            onClick={() => void openTool()}
            settingsLabel="External merge tool settings"
            settingsDisabled={busy !== null || editor.command === null}
            onSettings={() => setModal("editor")}
          >
            {busy === "tool" ? "Waiting for merge tool…" : "Open in merge tool"}
          </ToolWithSettings>
          <button
            className="primary"
            disabled={busy !== null}
            title="Write the output to the file, and mark it resolved once no conflict markers are left"
            onClick={() => void save()}
          >
            {busy === "save" ? "Saving…" : "Save"}
          </button>
        </span>
      )}
    </header>
  );

  /** The editor's frame: the header and its setup modals around `body`. */
  const frame = (body: ReactNode): React.JSX.Element => (
    <div className="conflict-editor">
      {header}
      {body}
      {modal && (
        <CommandModal
          which={modal}
          initialCommand={(modal === "editor" ? editor : ai).command ?? ""}
          onSave={(command) => {
            setModal(null);
            void (modal === "editor" ? editor : ai).save(command);
          }}
          onDismiss={() => setModal(null)}
        />
      )}
    </div>
  );

  if (!file) {
    return frame(
      <p className="placeholder">
        {conflicts.files.length > 0
          ? "This file is resolved. Pick another conflicted file in the sidebar."
          : "This file is resolved, and so is every other one. Finish in the sidebar."}
      </p>,
    );
  }
  if (!versions) return frame(<p className="placeholder">Loading…</p>);
  if (versions.binary) {
    return frame(
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
      </div>,
    );
  }

  return frame(
    <>
      <div className="conflict-sides">
        <div className="conflict-columns-head">
          <span>Current{conflicts.current && ` (${conflicts.current})`}</span>
          <span>Incoming{conflicts.incoming && ` (${conflicts.incoming})`}</span>
        </div>
        {parsed.segments.map((segment, segmentIndex) =>
          segment.kind === "common" ? (
            <CommonLines key={segmentIndex} lines={segment.lines} />
          ) : (
            <div key={segmentIndex} className="conflict-block">
              <ConflictSide segment={segment} side="current" picked={picked} onToggle={toggle} />
              <ConflictSide segment={segment} side="incoming" picked={picked} onToggle={toggle} />
            </div>
          ),
        )}
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
            <button onClick={() => pickLines(new Set(sideKeys(parsed, "current")))}>
              Take all current
            </button>
            <button onClick={() => pickLines(new Set(sideKeys(parsed, "incoming")))}>
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
    </>,
  );
}

interface ToolWithSettingsProps {
  /** The main button's label. */
  children: ReactNode;
  title: string;
  disabled: boolean;
  onClick: () => void;
  /** Accessible name and tooltip of the gear button beside it. */
  settingsLabel: string;
  settingsDisabled: boolean;
  onSettings: () => void;
}

/** A header button with a gear button beside it that opens its settings. */
function ToolWithSettings({
  children,
  title,
  disabled,
  onClick,
  settingsLabel,
  settingsDisabled,
  onSettings,
}: ToolWithSettingsProps): React.JSX.Element {
  return (
    <span className="conflict-tool button-group">
      <button disabled={disabled} title={title} onClick={onClick}>
        {children}
      </button>
      <button
        aria-label={settingsLabel}
        title={settingsLabel}
        disabled={settingsDisabled}
        onClick={onSettings}
      >
        &#9881;
      </button>
    </span>
  );
}

/**
 * Lines both sides agree on. A long stretch is folded to its first and last
 * few lines, with a button between them that unfolds it.
 */
function CommonLines({ lines }: { lines: string[] }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const folded = lines.length > FOLD_OVER && !expanded;
  const parts = folded
    ? [lines.slice(0, FOLD_CONTEXT), lines.slice(-FOLD_CONTEXT)]
    : [lines];
  return (
    <div className="conflict-common">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {/* The fold sits between the two visible ends. */}
          {index === 1 && (
            <button className="conflict-fold" onClick={() => setExpanded(true)}>
              ⋯ {pluralize(lines.length - 2 * FOLD_CONTEXT, "unchanged line")}
            </button>
          )}
          {part.map((line, i) => (
            <div key={i} className="conflict-line">
              {/* A space keeps an empty line one line tall. */}
              <span className="code">{line || " "}</span>
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

interface ConflictSideProps {
  segment: ConflictSegment;
  side: Side;
  picked: ReadonlySet<string>;
  onToggle: (key: string) => void;
}

/** One side of a conflict, each line with a checkbox that picks it for the output. */
function ConflictSide({ segment, side, picked, onToggle }: ConflictSideProps): React.JSX.Element {
  const lines = segment[side];
  return (
    <div className={`conflict-side ${side}`}>
      {lines.length === 0 && <div className="conflict-side-empty">No lines</div>}
      {lines.map((line, i) => {
        const key = lineKey(segment.index, side, i);
        return (
          <label key={i} className={`conflict-line${picked.has(key) ? " picked" : ""}`}>
            <input type="checkbox" checked={picked.has(key)} onChange={() => onToggle(key)} />
            <span className="code">{line || " "}</span>
          </label>
        );
      })}
    </div>
  );
}
