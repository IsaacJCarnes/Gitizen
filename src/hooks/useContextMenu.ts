import { useCallback, useState } from "react";

/** An open right-click menu: where it was opened, and what for. */
export interface OpenMenu<T> {
  x: number;
  y: number;
  target: T;
}

/**
 * State for a right-click menu. Call `openMenu` from `onContextMenu` with
 * what the menu is for; render a `ContextMenu` at `menu` while it is set,
 * closing it with `closeMenu`.
 */
export function useContextMenu<T>(): {
  menu: OpenMenu<T> | null;
  openMenu: (event: React.MouseEvent, target: T) => void;
  closeMenu: () => void;
} {
  const [menu, setMenu] = useState<OpenMenu<T> | null>(null);
  const openMenu = useCallback((event: React.MouseEvent, target: T): void => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, target });
  }, []);
  const closeMenu = useCallback((): void => setMenu(null), []);
  return { menu, openMenu, closeMenu };
}
