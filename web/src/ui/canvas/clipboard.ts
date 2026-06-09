import type { Element } from "../../types.ts";
import { escapeText } from "./url.ts";

// Elements go on the OS clipboard so a copy can be pasted into another board, tab, session, or app.
//   • text/html — readable rendered content (notes as HTML, links as <a>, images as <img src>) for
//     foreign rich editors, with the full element JSON in a hidden data-* attr that meko reads back
//     for a lossless round trip (others ignore it).
//   • text/plain — a one-line-per-element summary for plain-text targets.
// (Pasting INTO Milanote can't reconstruct cards — it only rebuilds from its own server-id JSON — so
// we don't chase that; the value is meko↔meko and Milanote→meko, handled by parseMilanoteHtml below.)
const MARKER = "data-meko-elements";

function attr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function renderHtml(e: Element): string {
  switch (e.type) {
    case "note":
    case "text":
      return `<div>${e.text}</div>`;
    case "link":
      return `<p><a href="${attr(e.url)}">${escapeText(e.title || e.url)}</a></p>`;
    case "embed":
      return e.src ? `<p><a href="${attr(e.src)}">${escapeText(e.src)}</a></p>` : "";
    case "image":
      return e.src
        ? `<img src="${attr(e.src)}"${e.alt ? ` alt="${attr(e.alt)}"` : ""} />`
        : "";
    case "todo":
      return `<p>${escapeText(e.title || "To-do")}</p><ul>${e.items
        .map((i) => `<li>${escapeText(i.text)}</li>`)
        .join("")}</ul>`;
    case "board":
    case "column":
      return `<p><b>${escapeText(e.title || e.type)}</b></p>`;
    default:
      return "";
  }
}

function plainText(e: Element): string {
  switch (e.type) {
    case "note":
    case "text":
      return e.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    case "link":
      return e.url;
    case "embed":
      return e.src ?? "";
    case "image":
      return e.alt ?? e.src ?? "Image";
    case "todo":
    case "board":
    case "column":
      return e.title || e.type;
    default:
      return e.type;
  }
}

export function serializeElements(els: Element[]): { html: string; text: string } {
  const json = encodeURIComponent(JSON.stringify(els));
  const body = els.map(renderHtml).filter(Boolean).join("");
  const html = `<div ${MARKER}="${json}">${body}</div>`;
  const text = els.map(plainText).filter(Boolean).join("\n") || "meko elements";
  return { html, text };
}

// Parse elements back out of a clipboard text/html payload; null if it isn't a meko copy.
export function deserializeElements(html: string): Element[] | null {
  const m = html.match(/data-meko-elements="([^"]*)"/);
  if (!m) return null;
  try {
    const els = JSON.parse(decodeURIComponent(m[1]!));
    return Array.isArray(els) && els.length ? (els as Element[]) : null;
  } catch {
    return null;
  }
}

export type MilanoteItem =
  | { kind: "image"; src: string; caption?: string }
  | { kind: "link"; url: string; title?: string; embedSrc?: string }
  | { kind: "note"; html: string };

// Parse a copied Milanote selection from its rich text/html. Milanote markup is a sequence of
// `.Element` cards: images carry `<img class="image-node">` (+ an optional `.Caption`), text cards a
// `.tiptap.ProseMirror` body, and a copied column leads with its title in an <h2>. Returns null when
// the html isn't Milanote's (so the normal external-paste path handles it). HTML is sanitised by the
// caller before it reaches the board.
export function parseMilanoteHtml(
  html: string,
): { title: string | null; items: MilanoteItem[] } | null {
  if (!html || !/ProseMirror|image-node|ListElement/.test(html)) return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }
  const cards = Array.from(doc.querySelectorAll(".Element"));
  if (!cards.length) return null;
  const title = doc.querySelector("h2")?.textContent?.trim() || null;
  const items: MilanoteItem[] = [];
  for (const card of cards) {
    const img = card.querySelector("img.image-node");
    const src = img?.getAttribute("src");
    if (src) {
      const cap = card.querySelector(".Caption .ProseMirror");
      const caption = cap?.innerHTML.trim() || undefined;
      items.push({ kind: "image", src, ...(caption ? { caption } : {}) });
      continue;
    }
    // Link / rich-media card: the page URL, its title, and a live embed iframe if present.
    const linkUrl = (
      card.querySelector("a.LinkURL") ?? card.querySelector(".LinkHeader a")
    )?.getAttribute("href");
    if (linkUrl) {
      const title =
        card.querySelector(".EditableTitle")?.textContent?.trim() || undefined;
      const embedSrc =
        card.querySelector("iframe")?.getAttribute("src") || undefined;
      items.push({
        kind: "link",
        url: linkUrl,
        ...(title ? { title } : {}),
        ...(embedSrc ? { embedSrc } : {}),
      });
      continue;
    }
    const tip = card.querySelector(".CardTiptapEditor .ProseMirror, .ProseMirror");
    const body = tip?.innerHTML.trim();
    if (body) items.push({ kind: "note", html: body });
  }
  return items.length ? { title, items } : null;
}
