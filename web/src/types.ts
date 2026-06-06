// Client mirror of the server element model (src/elements/schema.ts). Elements live in the board's
// Yjs doc under the "elements" Y.Map, keyed by id — the same shape the server validates and the
// export renderer reads.
export interface ElementStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  fontSize?: number;
  fontWeight?: "normal" | "bold";
  color?: string;
  align?: "left" | "center" | "right";
  strip?: string;
}

interface Base {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  z?: number;
  locked?: boolean;
  style?: ElementStyle;
}

export type Element =
  | (Base & { type: "note"; text: string })
  | (Base & { type: "text"; text: string })
  | (Base & { type: "image"; src: string; alt?: string; mediaId?: string; caption?: string; showCaption?: boolean })
  | (Base & { type: "link"; url: string; title?: string; description?: string; image?: string; embedSrc?: string; hideImage?: boolean; hideCaption?: boolean })
  | (Base & { type: "file"; name: string; downloadUrl: string; size: number })
  | (Base & { type: "embed"; src: string })
  | (Base & { type: "todo"; title?: string; items: TodoItem[] })
  | (Base & { type: "board"; boardId: string; title?: string })
  | (Base & { type: "column"; title?: string; children: string[]; collapsed?: boolean });

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

// Standalone line. Each endpoint is a free world point, optionally pinned to an element anchor
// (corner / edge-midpoint / centre) so it tracks the element. Snap targets are the 9 anchors.
export type AnchorKey = "tl" | "tm" | "tr" | "lm" | "c" | "rm" | "bl" | "bm" | "br";
export interface LineEndpoint {
  x: number;
  y: number;
  elementId?: string;
  anchor?: AnchorKey;
}
export interface LineShape {
  id: string;
  a: LineEndpoint;
  b: LineEndpoint;
  label?: string;
  color?: string;
  dashed?: boolean;
  weight?: number;
  bend?: { x: number; y: number };
  arrowStart?: boolean;
  arrowEnd?: boolean;
}

// Link between two elements. Straight by default; `bend` (control-point offset from the midpoint,
// world coords) curves it. Arrowheads at each end are independently toggleable.
export interface Connection {
  id: string;
  from: string;
  to: string;
  label?: string;
  color?: string; // line colour (hex); default slate
  dashed?: boolean;
  weight?: number; // stroke width in px
  bend?: { x: number; y: number };
  arrowStart?: boolean; // default false
  arrowEnd?: boolean; // default true
}

export interface Board {
  id: string;
  workspaceId: string;
  title: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
}
