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
  style?: ElementStyle;
}

export type Element =
  | (Base & { type: "note"; text: string })
  | (Base & { type: "text"; text: string })
  | (Base & { type: "image"; src: string; alt?: string; mediaId?: string; caption?: string; showCaption?: boolean })
  | (Base & { type: "link"; url: string; title?: string; description?: string; image?: string; hideImage?: boolean; hideCaption?: boolean })
  | (Base & { type: "file"; name: string; downloadUrl: string; size: number })
  | (Base & { type: "embed"; src: string })
  | (Base & { type: "todo"; title?: string; items: TodoItem[] })
  | (Base & { type: "board"; boardId: string; title?: string });

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

// Directed link between two elements, drawn as an arrow. Optional label shown at its midpoint.
export interface Connection {
  id: string;
  from: string;
  to: string;
  label?: string;
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
