// URL / clipboard / text helpers for the canvas. Pure.

export function linkHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const TWO_LEVEL_TLD = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);

// Human site name from a URL: the registrable label, capitalised. uk.pinterest.com → "Pinterest",
// example.co.uk → "Example". Falls back to the host.
export function siteName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const parts = host.split(".");
    let idx = parts.length - 2;
    if (parts.length > 2 && TWO_LEVEL_TLD.has(parts[parts.length - 2]!)) idx = parts.length - 3;
    const name = parts[idx] ?? host;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return linkHost(url);
  }
}

// Visible text of an HTML clipboard payload (note text often lives only here, not in text/plain).
export function htmlVisibleText(html: string): string {
  if (!html) return "";
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script, style, iframe").forEach((n) => n.remove());
    return (doc.body?.textContent ?? "").replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  } catch {
    return "";
  }
}

// All droppable items in a clipboard text/html payload, in document order (Milanote multi-select).
export function parseClipboardHtmlAll(html: string): { kind: "iframe" | "img" | "link"; value: string }[] {
  if (!html) return [];
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return [];
  }
  const out: { kind: "iframe" | "img" | "link"; value: string }[] = [];
  doc.querySelectorAll("iframe[src], img[src], a[href]").forEach((node) => {
    const el = node as HTMLElement;
    if (el.tagName === "IFRAME") {
      const v = el.getAttribute("src");
      if (v && /^https?:/i.test(v)) out.push({ kind: "iframe", value: v });
    } else if (el.tagName === "IMG") {
      const v = el.getAttribute("src");
      if (v && /^https?:/i.test(v)) out.push({ kind: "img", value: v });
    } else if (el.tagName === "A") {
      if (el.querySelector("img, iframe")) return; // wrapper around media already captured
      const v = el.getAttribute("href");
      if (v && /^https?:/i.test(v)) out.push({ kind: "link", value: v });
    }
  });
  return out;
}

export function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Load an image's natural dimensions (falls back to 4:3 on error).
export function loadImageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 4, h: img.naturalHeight || 3 });
    img.onerror = () => resolve({ w: 4, h: 3 });
    img.src = url;
  });
}

// An http(s) URL whose path ends in an image extension → render directly as an image element.
export function isImageUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return /^https?:$/.test(url.protocol) && /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(url.pathname);
  } catch {
    return false;
  }
}
