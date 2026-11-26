/** File extensions the image diff viewer shows (what the webview can draw). */
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "avif"]);

/** True for a path the image diff viewer handles instead of a text diff. */
export function isImagePath(path: string | undefined): boolean {
  if (!path?.includes(".")) return false;
  return IMAGE_EXTENSIONS.has(path.split(".").pop()?.toLowerCase() ?? "");
}
