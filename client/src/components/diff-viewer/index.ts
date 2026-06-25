/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract.
   parsePatch/Line are also re-exported for consumers that render their own diff rows. */
export { DiffViewer } from "./DiffViewer";
export type { DiffCommentApi } from "./comments";
export { parsePatch } from "./helpers";
export type { Line } from "./helpers";
