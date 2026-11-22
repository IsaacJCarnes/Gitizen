import "./ContextMenu.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** One clickable entry of a `ContextMenu`. */
export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Tooltip, e.g. why the item is disabled. */
  title?: string;
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
 * Mount it while it should be open.
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
      className="context-menu"
      role="menu"
      style={position}
      // The menu's own right-click shouldn't open the browser's menu.
      onContextMenu={(event) => event.preventDefault()}
    >
      {entries.map((entry, index) =>
        entry === "separator" ? (
          <hr key={`separator-${index}`} />
        ) : (
          <button
            key={entry.label}
            role="menuitem"
            disabled={entry.disabled}
            title={entry.title}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
          >
            {entry.label}
          </button>
        ),
      )}
    </div>
  );
}
