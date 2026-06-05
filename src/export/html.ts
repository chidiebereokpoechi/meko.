import * as Y from "yjs";
import { Element } from "@/elements/schema.ts";

// Board elements are stored in the Yjs document under a top-level Y.Map named "elements", keyed by
// element id. Read it back as plain objects and keep only those that pass the Element schema —
// a corrupt or hostile entry is dropped rather than rendered.
export function extractElements(doc: Y.Doc): Element[] {
  const raw = doc.getMap("elements").toJSON() as Record<string, unknown>;
  const out: Element[] = [];
  for (const value of Object.values(raw)) {
    const parsed = Element.safeParse(value);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

// Escape every interpolated string. Chromium renders this document, so unescaped user text would
// be live XSS inside the export context (§8b). Style values are already hex/enum-validated (§4b).
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function styleAttr(e: Element): string {
  const s = e.style ?? {};
  const decls = [
    `left:${e.x}px`,
    `top:${e.y}px`,
    `width:${e.w}px`,
    `height:${e.h}px`,
    e.rotation ? `transform:rotate(${e.rotation}deg)` : "",
    s.fill ? `background:${s.fill}` : "",
    s.stroke ? `border:${s.strokeWidth ?? 1}px solid ${s.stroke}` : "",
    s.opacity != null ? `opacity:${s.opacity}` : "",
    s.fontSize ? `font-size:${s.fontSize}px` : "",
    s.fontWeight ? `font-weight:${s.fontWeight}` : "",
  ].filter(Boolean);
  return decls.join(";");
}

function renderElement(e: Element): string {
  const base = `position:absolute;${styleAttr(e)};box-sizing:border-box;overflow:hidden`;
  switch (e.type) {
    case "note":
    case "text":
      return `<div style="${base};padding:6px;white-space:pre-wrap">${esc(e.text)}</div>`;
    case "link":
      return `<div style="${base};padding:6px;border:1px solid #ccc">${esc(e.title ?? e.url)}</div>`;
    case "image":
      // Media is not inlined yet (would require fetching derivatives server-side); render a
      // labelled placeholder. External URLs are never fetched here — avoids SSRF + sidecar egress.
      return `<div style="${base};border:1px dashed #999;display:flex;align-items:center;justify-content:center;color:#666">${esc(e.alt ?? "image")}</div>`;
    case "file":
      return `<div style="${base};border:1px solid #ccc;padding:6px">${esc(e.name)}</div>`;
    case "embed":
      return `<div style="${base};border:1px dashed #999"></div>`;
  }
}

// Self-contained HTML document (§8b): no external references, so the sidecar's Chromium needs no
// network egress to render it.
export function buildExportHtml(title: string, elements: Element[]): string {
  const body = elements.map(renderElement).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>html,body{margin:0;padding:0;background:#fff;font-family:system-ui,sans-serif}#canvas{position:relative}</style>
</head><body><div id="canvas">${body}</div></body></html>`;
}
