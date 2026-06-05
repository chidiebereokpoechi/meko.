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
    color: Hex.optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    // Coloured top strip across the top edge of a note (Milanote pattern); absent = no strip.
    strip: Hex.optional(),
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
  .object({
    ...Base,
    type: z.literal("image"),
    src: SafeUrl,
    alt: z.string().max(1_000).optional(),
    // Durable reference to the uploaded media; src is a presigned URL that expires, so clients
    // re-resolve via GET /api/media/:mediaId on load. Optional for externally-sourced images.
    mediaId: z.string().uuid().optional(),
    // Optional editable caption beneath the image (sanitised HTML), toggled by showCaption.
    caption: z.string().max(2000).optional(),
    showCaption: z.boolean().optional(),
  })
  .strict();
export const LinkElement = z
  .object({
    ...Base,
    type: z.literal("link"),
    url: SafeUrl,
    title: z.string().max(500).optional(),
    description: z.string().max(2000).optional(),
    // Unfurl preview image (remote OG image URL); http(s)-only.
    image: SafeUrl.optional(),
    // Per-card toggles (absent = shown).
    hideImage: z.boolean().optional(),
    hideCaption: z.boolean().optional(),
  })
  .strict();
export const FileElement = z
  .object({ ...Base, type: z.literal("file"), name: z.string().max(500), downloadUrl: SafeUrl, size: z.number().int().min(0) })
  .strict();
export const EmbedElement = z.object({ ...Base, type: z.literal("embed"), src: SafeUrl }).strict();

const TodoItem = z.object({ id: z.string().min(1), text: z.string().max(1_000), done: z.boolean() }).strict();
export const TodoElement = z
  .object({ ...Base, type: z.literal("todo"), title: z.string().max(500).optional(), items: z.array(TodoItem).max(500) })
  .strict();

// A tile that opens another board in the same workspace (nested boards).
export const BoardElement = z
  .object({ ...Base, type: z.literal("board"), boardId: z.string().uuid(), title: z.string().max(300).optional() })
  .strict();

export const Element = z.discriminatedUnion("type", [
  NoteElement,
  TextElement,
  ImageElement,
  LinkElement,
  FileElement,
  EmbedElement,
  TodoElement,
  BoardElement,
]);

export type Element = z.infer<typeof Element>;
export type ElementType = Element["type"];
