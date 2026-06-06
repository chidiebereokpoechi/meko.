import type { AnchorKey, Connection, Element, LineEndpoint, LineShape } from "../../types.ts";

// Geometry for connections (element→element arrows) and standalone lines. Pure — no React/DOM.

export type Pt = { x: number; y: number };

export const CONN_DEFAULT = "#475569"; // slate-600 — default arrow/line colour

// The 9 snap anchors of an element: corners, edge-midpoints, centre.
export const ANCHOR_KEYS: AnchorKey[] = ["tl", "tm", "tr", "lm", "c", "rm", "bl", "bm", "br"];

// Point on an element's border in the direction of (tx,ty) — where an arrow should touch.
export function edgePoint(e: Element, tx: number, ty: number): Pt {
  const x = e.x + e.w / 2;
  const y = e.y + e.h / 2;
  const dx = tx - x;
  const dy = ty - y;
  if (!dx && !dy) return { x, y };
  const s = 1 / Math.max(Math.abs(dx) / (e.w / 2 || 1), Math.abs(dy) / (e.h / 2 || 1));
  return { x: x + dx * s, y: y + dy * s };
}

export function anchorPoint(el: Element, key: AnchorKey): Pt {
  const left = key === "tl" || key === "lm" || key === "bl";
  const right = key === "tr" || key === "rm" || key === "br";
  const top = key === "tl" || key === "tm" || key === "tr";
  const bottom = key === "bl" || key === "bm" || key === "br";
  return {
    x: left ? el.x : right ? el.x + el.w : el.x + el.w / 2,
    y: top ? el.y : bottom ? el.y + el.h : el.y + el.h / 2,
  };
}

// Nearest element anchor to a world point within threshold; null if none close.
export function nearestAnchor(p: Pt, els: Element[], threshold: number): { elementId: string; anchor: AnchorKey; pt: Pt } | null {
  let best: { elementId: string; anchor: AnchorKey; pt: Pt } | null = null;
  let bestD = threshold;
  for (const el of els) {
    for (const k of ANCHOR_KEYS) {
      const a = anchorPoint(el, k);
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = { elementId: el.id, anchor: k, pt: a };
      }
    }
  }
  return best;
}

// Resolve a line endpoint to a world point — a pinned endpoint tracks its element's anchor.
export function resolveEnd(ep: LineEndpoint, byId: Map<string, Element>): Pt {
  if (ep.elementId && ep.anchor) {
    const el = byId.get(ep.elementId);
    if (el) return anchorPoint(el, ep.anchor);
  }
  return { x: ep.x, y: ep.y };
}

export interface ConnLine {
  c: Connection;
  p1: Pt; // visible edge endpoints (for handles + label midpoint)
  p2: Pt;
  ctrl: Pt | null; // quadratic control point when bent, else null (straight)
  handle: Pt; // midpoint bend handle (sits on the line)
  d: string; // SVG path — drawn from element CENTRES (behind the card) for ends without an arrow
}

// Straight by default; a quadratic through the control point when bent.
export function connPath(p1: Pt, p2: Pt, ctrl: Pt | null): string {
  return ctrl ? `M${p1.x},${p1.y} Q${ctrl.x},${ctrl.y} ${p2.x},${p2.y}` : `M${p1.x},${p1.y} L${p2.x},${p2.y}`;
}

// Resolve each connection's geometry. The path is drawn from a card's CENTRE when that end has no
// arrowhead, so the line tucks behind the card and emerges cleanly at its edge regardless of size;
// the arrowhead end anchors on the border. Handles + label use the visible edge points. A dragged
// endpoint follows the cursor.
export function computeLines(elements: Element[], connections: Connection[], connDrag: { id: string; which: "from" | "to"; pos: Pt } | null): ConnLine[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const out: ConnLine[] = [];
  for (const c of connections) {
    const from = byId.get(c.from);
    const to = byId.get(c.to);
    if (!from || !to) continue;
    const fromC = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
    const toC = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
    const ctrl = c.bend ? { x: (fromC.x + toC.x) / 2 + c.bend.x, y: (fromC.y + toC.y) / 2 + c.bend.y } : null;
    const dragFrom = connDrag?.id === c.id && connDrag.which === "from";
    const dragTo = connDrag?.id === c.id && connDrag.which === "to";
    const fromAim = ctrl ?? (dragTo ? connDrag!.pos : toC);
    const toAim = ctrl ?? (dragFrom ? connDrag!.pos : fromC);
    const edge1 = dragFrom ? connDrag!.pos : edgePoint(from, fromAim.x, fromAim.y);
    const edge2 = dragTo ? connDrag!.pos : edgePoint(to, toAim.x, toAim.y);
    const startArrow = c.arrowStart ?? false;
    const endArrow = c.arrowEnd ?? true;
    const draw1 = dragFrom ? connDrag!.pos : startArrow ? edge1 : fromC;
    const draw2 = dragTo ? connDrag!.pos : endArrow ? edge2 : toC;
    const handle = ctrl
      ? { x: 0.25 * edge1.x + 0.5 * ctrl.x + 0.25 * edge2.x, y: 0.25 * edge1.y + 0.5 * ctrl.y + 0.25 * edge2.y }
      : { x: (edge1.x + edge2.x) / 2, y: (edge1.y + edge2.y) / 2 };
    out.push({ c, p1: edge1, p2: edge2, ctrl, handle, d: connPath(draw1, draw2, ctrl) });
  }
  return out;
}

export interface LineGeo {
  l: LineShape;
  a: Pt;
  b: Pt;
  ctrl: Pt | null;
  handle: Pt;
  d: string;
}

// Resolve standalone-line geometry (endpoints + optional bend), honouring a dragged endpoint.
export function computeLineGeo(lines: LineShape[], elements: Element[], lineDrag: { id: string; which: "a" | "b"; ep: LineEndpoint } | null): LineGeo[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  return lines.map((l) => {
    const aEp = lineDrag?.id === l.id && lineDrag.which === "a" ? lineDrag.ep : l.a;
    const bEp = lineDrag?.id === l.id && lineDrag.which === "b" ? lineDrag.ep : l.b;
    const a = resolveEnd(aEp, byId);
    const b = resolveEnd(bEp, byId);
    const ctrl = l.bend ? { x: (a.x + b.x) / 2 + l.bend.x, y: (a.y + b.y) / 2 + l.bend.y } : null;
    const handle = ctrl
      ? { x: 0.25 * a.x + 0.5 * ctrl.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * ctrl.y + 0.25 * b.y }
      : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return { l, a, b, ctrl, handle, d: connPath(a, b, ctrl) };
  });
}
