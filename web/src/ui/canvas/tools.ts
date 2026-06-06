// Create-tool specs: default placeholder size, optional dialog-fill kind, and the element factory.
// One entry per tool key in the create rail; startPlace() looks the spec up instead of switching.
import type { Element } from "../../types.ts";

export type FillKind = "image" | "link" | "embed" | "board";
type Base = { id: string; x: number; y: number; w: number; h: number };

export type ToolSpec = {
  w: number; // default placeholder width
  h: number; // default placeholder height
  fill?: FillKind; // input tools open a dialog to fill the placeholder
  nestable?: boolean; // can drop into a column (columns themselves can't nest)
  make: (base: Base) => Element;
};

export const TOOL_SPECS: Record<string, ToolSpec> = {
  note: { w: 220, h: 120, nestable: true, make: (b) => ({ ...b, type: "note", text: "", style: { fill: "#ffffff" } }) },
  todo: { w: 240, h: 140, nestable: true, make: (b) => ({ ...b, type: "todo", title: "", items: [{ id: crypto.randomUUID(), text: "", done: false }], style: { fill: "#ffffff" } }) },
  column: { w: 280, h: 120, make: (b) => ({ ...b, type: "column", title: "", children: [], style: { fill: "#ffffff" } }) },
  image: { w: 280, h: 180, fill: "image", nestable: true, make: (b) => ({ ...b, type: "image", src: "" }) },
  link: { w: 260, h: 96, fill: "link", nestable: true, make: (b) => ({ ...b, type: "link", url: "" }) },
  embed: { w: 360, h: 203, fill: "embed", nestable: true, make: (b) => ({ ...b, type: "embed", src: "" }) },
  board: { w: 200, h: 116, fill: "board", nestable: true, make: (b) => ({ ...b, type: "board", boardId: "", title: "" }) },
};
