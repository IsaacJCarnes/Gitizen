import "./ContextMenu.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** One clickable entry of a `ContextMenu`. */
export interface MenuItem {
  label: string;
  /** Called when chosen; leave out for an item that only opens `submenu`. */
  onSelect?: () => void;
  disabled?: boolean;
  /** Tooltip, e.g. why the item is disabled. */
  title?: string;
  /** Entries shown beside the item when it is hovered or clicked. */
  submenu?: MenuEntry[];
}

/** An item, or "separator" for a dividing line between groups. */
export type MenuEntry = MenuItem | "separator";

interface ContextMenuProps {
  /** Where the right-click happened, in viewport pixels. */
  x: number;
  y: number;
  entries: MenuEntry[];
  onClose: () => void;
}

/**
 * A right-click menu drawn at the pointer. It closes on a click outside,
 * Escape, scrolling, or the window losing focus, and after an item is chosen.
 * Items with a submenu open it beside them on hover, click or the right
 * arrow key. Mount it while it should be open.
 */
export default function ContextMenu({ x, y, entries, onClose }: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep the menu inside the window: flip it left or up when it would run
  // off the right or bottom edge. Measured before paint, so it never jumps.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: x + width > window.innerWidth ? Math.max(0, x - width) : x,
      top: y + height > window.innerHeight ? Math.max(0, y - height) : y,
    });
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    // `true` (capture) also catches scrolling inside any scrollable panel.
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onClose, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onClose, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="context-menu popover"
      role="menu"
      style={position}
      // The menu's own right-click shouldn't open the browser's menu.
      onContextMenu={(event) => event.preventDefault()}
    >
      <MenuEntries entries={entries} onClose={onClose} />
    </div>
  );
}

/** The buttons of one menu level; a submenu renders another level beside its item. */
function MenuEntries({ entries, onClose }: { entries: MenuEntry[]; onClose: () => void }): React.JSX.Element {
  // Index of the item whose submenu is open.
  const [open, setOpen] = useState<number | null>(null);

  return (
    <>
      {entries.map((entry, index) => {
        if (entry === "separator") return <hr key={`separator-${index}`} />;
        const { submenu } = entry;
        return (
          <div
            key={`${entry.label}-${index}`}
            className="context-menu-item"
            onPointerEnter={() => setOpen(submenu ? index : null)}
          >
            <button
              role="menuitem"
              aria-haspopup={submenu ? "menu" : undefined}
              aria-expanded={submenu ? open === index : undefined}
              disabled={entry.disabled}
              title={entry.title}
              onKeyDown={(event) => {
                if (submenu && event.key === "ArrowRight") setOpen(index);
                if (event.key === "ArrowLeft") setOpen(null);
              }}
              onClick={() => {
                if (submenu) {
                  setOpen(index);
                  return;
                }
                onClose();
                entry.onSelect?.();
              }}
            >
              {entry.label}
              {submenu && <span className="context-menu-arrow" aria-hidden="true">▸</span>}
            </button>
            {submenu && open === index && <Submenu entries={submenu} onClose={onClose} />}
          </div>
        );
      })}
    </>
  );
}

/** A nested menu to the right of its item, or to the left if there's no room. */
function Submenu({ entries, onClose }: { entries: MenuEntry[]; onClose: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<"right" | "left">("right");

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    if (menu.getBoundingClientRect().right > window.innerWidth) setSide("left");
  }, []);

  return (
    <div ref={ref} className={`context-menu popover context-submenu ${side}`} role="menu">
      <MenuEntries entries={entries} onClose={onClose} />
    </div>
  );
}
