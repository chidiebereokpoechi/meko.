import { z } from "zod";
import { SafeUrl } from "@/lib/safe-url.ts";

// Element model (§4). Elements live inside the board's Yjs document as CRDT shared types; this
// schema is the validation contract applied wherever an element crosses a trust boundary:
// REST element imports, unfurl persistence, and export rendering. URL fields use the http(s)-only
// SafeUrl validator (§4d); colours are hex-only (§4b) so no CSS expression can be injected.

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "colour must be #rrggbb");

const Style = z
  .object({
    fill: Hex.optional(),
    stroke: Hex.optional(),
    strokeWidth: z.number().min(0).max(64).optional(),
    opacity: z.number().min(0).max(1).optional(),
    fontSize: z.number().min(1).max(512).optional(),
    fontWeight: z.enum(["normal", "bold"]).optional(),
  })
  .strict();

// Shared geometry every element carries on the canvas.
const Base = {
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  w: z.number().min(0),
  h: z.number().min(0),
  rotation: z.number().optional(),
  style: Style.optional(),
};

export const NoteElement = z.object({ ...Base, type: z.literal("note"), text: z.string().max(10_000) }).strict();
export const TextElement = z.object({ ...Base, type: z.literal("text"), text: z.string().max(50_000) }).strict();
export const ImageElement = z
  .object({ ...Base, type: z.literal("image"), src: SafeUrl, alt: z.string().max(1_000).optional() })
  .strict();
export const LinkElement = z
  .object({ ...Base, type: z.literal("link"), url: SafeUrl, title: z.string().max(500).optional() })
  .strict();
export const FileElement = z
  .object({ ...Base, type: z.literal("file"), name: z.string().max(500), downloadUrl: SafeUrl, size: z.number().int().min(0) })
  .strict();
export const EmbedElement = z.object({ ...Base, type: z.literal("embed"), src: SafeUrl }).strict();

export const Element = z.discriminatedUnion("type", [
  NoteElement,
  TextElement,
  ImageElement,
  LinkElement,
  FileElement,
  EmbedElement,
]);

export type Element = z.infer<typeof Element>;
export type ElementType = Element["type"];
