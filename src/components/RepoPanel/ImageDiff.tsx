import "./ImageDiff.css";
import { useEffect, useState } from "react";
import type { ImageVersions } from "../../../shared/gitTypes";
import { gitizen } from "../../api/gitizen";
import type { ImageDiffMode } from "../../hooks/useDiffSettings";
import { loadUnlessCancelled } from "../../utils/load";

interface ImageDiffProps {
  path: string;
  /** A renamed file's previous path. */
  oldPath?: string;
  /** The commit (or stash) shown; left out for the working tree. */
  hash?: string;
  /** True when `hash` is a stash. */
  stash?: boolean;
  mode: ImageDiffMode;
  /** Changes whenever the file may have changed on disk, to load it again. */
  reloadKey?: unknown;
  /** Told whether both versions exist, so the comparison modes only show then. */
  onComparable?: (comparable: boolean) => void;
}

/** Natural size of a loaded image, shown under each side. */
type Size = { width: number; height: number } | null;

/**
 * An image's two versions, in one of three modes: side by side; stacked
 * with a slider that wipes from the old version (left) to the new (right);
 * or stacked with a slider that fades from one into the other. An added or
 * deleted image just shows the side that exists.
 */
export default function ImageDiff({
  path,
  oldPath,
  hash,
  stash,
  mode,
  reloadKey,
  onComparable,
}: ImageDiffProps): React.JSX.Element {
  const [versions, setVersions] = useState<ImageVersions | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Slider position, 0 (all old) to 100 (all new).
  const [position, setPosition] = useState(50);
  const [oldSize, setOldSize] = useState<Size>(null);
  const [newSize, setNewSize] = useState<Size>(null);

  useEffect(() => {
    setError(null);
    return loadUnlessCancelled(
      gitizen.imageVersions(path, oldPath, hash, stash),
      (next) => {
        setVersions(next);
        onComparable?.(Boolean(next.old && next.new));
      },
      (caught) => {
        setVersions(null);
        setError(String(caught));
        onComparable?.(false);
      },
    );
  }, [path, oldPath, hash, stash, reloadKey, onComparable]);

  if (error) return <p className="placeholder">{error}</p>;
  if (!versions) return <p className="placeholder">Loading image…</p>;
  const { old, new: next } = versions;
  if (!old && !next) return <p className="placeholder">No image to show.</p>;

  const measure =
    (set: (size: Size) => void) =>
    (event: React.SyntheticEvent<HTMLImageElement>): void =>
      set({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
  const sizeLabel = (size: Size): string => (size ? `${size.width} × ${size.height}` : "");

  // Only one side exists (added or deleted): nothing to compare.
  if (!old || !next) {
    const only = (old ?? next) as string;
    return (
      <div className="image-diff">
        <figure className={`image-side ${old ? "deleted" : "added"}`}>
          <figcaption>{old ? "Deleted" : "Added"}</figcaption>
          <div className="image-frame">
            <img src={only} alt={path} onLoad={measure(old ? setOldSize : setNewSize)} />
          </div>
          <small>{sizeLabel(old ? oldSize : newSize)}</small>
        </figure>
      </div>
    );
  }

  if (mode === "side") {
    return (
      <div className="image-diff side-by-side">
        <figure className="image-side deleted">
          <figcaption>Before</figcaption>
          <div className="image-frame">
            <img src={old} alt={`${path} before`} onLoad={measure(setOldSize)} />
          </div>
          <small>{sizeLabel(oldSize)}</small>
        </figure>
        <figure className="image-side added">
          <figcaption>After</figcaption>
          <div className="image-frame">
            <img src={next} alt={`${path} after`} onLoad={measure(setNewSize)} />
          </div>
          <small>{sizeLabel(newSize)}</small>
        </figure>
      </div>
    );
  }

  // Stacked: the new image on top of the old one, cut off (swipe) or made
  // see-through (fade) by the slider.
  const bottomStyle: React.CSSProperties =
    mode === "swipe"
      ? { clipPath: `inset(0 0 0 ${position}%)` }
      : { opacity: 1 - (position / 100) };
  const topStyle: React.CSSProperties =
    mode === "swipe"
      ? { clipPath: `inset(0 ${100 - position}% 0 0)` }
      : { opacity: position / 100 };
  
  return (
    <div className="image-diff stacked">
      <div className="image-stack-labels">
        <span className="deleted">Before {sizeLabel(oldSize)}</span>
        <span className="added">After {sizeLabel(newSize)}</span>
      </div>
      <div className="image-frame image-stack">
        <img src={old} alt={`${path} before`} onLoad={measure(setOldSize)} style={bottomStyle}/>
        <img className="image-top" src={next} alt={`${path} after`} style={topStyle} onLoad={measure(setNewSize)} />
        {mode === "swipe" && <span className="image-swipe-line" style={{ left: `${position}%` }} />}
      </div>
      <input
        className="image-slider"
        type="range"
        min={0}
        max={100}
        value={position}
        aria-label={mode === "swipe" ? "Swipe between before and after" : "Fade between before and after"}
        onChange={(event) => setPosition(Number(event.target.value))}
      />
    </div>
  );
}
