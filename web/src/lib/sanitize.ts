// Notes store rich text as HTML in the Yjs doc. That HTML comes from other users, so it MUST be
// sanitised before it is persisted AND before it is rendered (defence in depth; CSP is the
// backstop). Allowlist tags + a tiny set of style properties; everything else is unwrapped or
// dropped. Inline event handlers, scripts, javascript: hrefs, url()/expression() styles never pass.

const ALLOWED = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "UL", "OL", "LI", "BR", "DIV", "P", "SPAN", "A", "FONT"]);
const STYLE_PROPS = new Set(["color", "font-weight", "font-style", "text-decoration", "text-align"]);
const SAFE_VALUE = /^[#0-9a-z(),.\s%-]+$/i; // hex / rgb() / keywords; no url(, no ;, no expression

function filterStyle(style: string): string {
  return style
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(":");
      if (i < 0) return "";
      const prop = d.slice(0, i).trim().toLowerCase();
      const val = d.slice(i + 1).trim();
      return STYLE_PROPS.has(prop) && SAFE_VALUE.test(val) && !/expression|url\(/i.test(val) ? `${prop}:${val}` : "";
    })
    .filter(Boolean)
    .join(";");
}

function cleanElement(el: HTMLElement) {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (el.tagName === "A" && name === "href") {
      if (!/^https?:/i.test(el.getAttribute("href") ?? "")) el.removeAttribute("href");
    } else if (name === "style") {
      const filtered = filterStyle(el.getAttribute("style") ?? "");
      if (filtered) el.setAttribute("style", filtered);
      else el.removeAttribute("style");
    } else if (el.tagName === "FONT" && name === "color") {
      if (!SAFE_VALUE.test(el.getAttribute("color") ?? "")) el.removeAttribute("color");
    } else {
      el.removeAttribute(attr.name);
    }
  }
  if (el.tagName === "A") {
    el.setAttribute("rel", "noopener noreferrer");
    el.setAttribute("target", "_blank");
  }
}

function clean(node: Node) {
  // Post-order: clean descendants first, so unwrapped children are already safe when promoted.
  for (const child of Array.from(node.childNodes)) if (child.nodeType === 1) clean(child);
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) continue; // text
    if (child.nodeType !== 1) {
      child.remove();
      continue;
    }
    const el = child as HTMLElement;
    if (!ALLOWED.has(el.tagName)) {
      while (el.firstChild) node.insertBefore(el.firstChild, el);
      el.remove();
    } else {
      cleanElement(el);
    }
  }
}

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, "text/html");
  const root = doc.getElementById("root")!;
  clean(root);
  return root.innerHTML;
}
