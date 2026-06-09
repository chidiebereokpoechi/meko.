import { useState } from "react";
import type { BoardConnection } from "../../lib/board.ts";
import type {
  Connection,
  Element,
  LineEndpoint,
  LineShape,
} from "../../types.ts";
import {
  computeLineGeo,
  computeLines,
  nearestAnchor,
  resolveEnd,
} from "./geometry.ts";
import { startPointerDrag } from "./drag.ts";

type Pt = { x: number; y: number };
type Sized = Element & { h: number };

// Length (world units) of the line dropped when the tool is clicked without dragging.
const DEFAULT_LINE_LEN = 120;

// Edges = arrows (connections) between elements + standalone lines. This hook owns all edge state
// (in-progress link drag, endpoint/bend drags, the line tool, selection + inline label editing) and
// the derived geometry the canvas renders, so Canvas only wires it up. Element selection still lives
// in Canvas, so it passes the selection setters in (drawing a line clears the element selection).
export function useEdges(deps: {
  connRef: React.RefObject<BoardConnection | null>;
  toWorld: (clientX: number, clientY: number) => Pt;
  zoom: number;
  elements: Element[];
  sizedElements: Sized[];
  childToCol: Map<string, string>;
  connections: Connection[];
  lines: LineShape[];
  readOnly: boolean;
  setSelectedIds: (ids: string[]) => void;
}) {
  const {
    connRef,
    toWorld,
    zoom,
    elements,
    sizedElements,
    childToCol,
    connections,
    lines,
    readOnly,
    setSelectedIds,
  } = deps;

  // In-progress arrow drag from an element's connect ball; linkEnd is the live pointer (world).
  const [linking, setLinking] = useState<{ from: string } | null>(null);
  const [linkEnd, setLinkEnd] = useState<Pt | null>(null);
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
  const [selectedConn, setSelectedConn] = useState<string | null>(null);
  const [editingConnLabel, setEditingConnLabel] = useState<string | null>(null);
  const [connDrag, setConnDrag] = useState<{
    id: string;
    which: "from" | "to";
    pos: Pt;
  } | null>(null);
  // Standalone line tool: arm (tool clicked), in-progress draw, selection, endpoint drag, label.
  const [armLine, setArmLine] = useState(false);
  const [lineDraw, setLineDraw] = useState<{
    a: LineEndpoint;
    b: LineEndpoint;
  } | null>(null);
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const [lineDrag, setLineDrag] = useState<{
    id: string;
    which: "a" | "b";
    ep: LineEndpoint;
  } | null>(null);
  const [editingLineLabel, setEditingLineLabel] = useState<string | null>(null);

  const connLines = computeLines(sizedElements, connections, connDrag);
  const lineGeo = computeLineGeo(lines, sizedElements, lineDrag);
  // Snap indicator ring while drawing or dragging an endpoint onto an element anchor.
  const snapPt = lineDraw?.b.elementId
    ? { x: lineDraw.b.x, y: lineDraw.b.y }
    : lineDrag?.ep.elementId
      ? { x: lineDrag.ep.x, y: lineDrag.ep.y }
      : null;

  // --- Connections (arrows between elements) ---
  const addConnection = (from: string, to: string) => {
    const c = connRef.current;
    if (!c || from === to) return;
    // Avoid duplicate arrows in the same direction.
    if (
      Array.from(c.connections.values()).some(
        (cn) => cn.from === from && cn.to === to,
      )
    )
      return;
    const id = crypto.randomUUID();
    c.connections.set(id, { id, from, to, arrowEnd: true });
  };
  const removeConnection = (id: string) => {
    connRef.current?.connections.delete(id);
    setSelectedConn((s) => (s === id ? null : s));
  };
  const setConnectionLabel = (id: string, label: string) => {
    const c = connRef.current;
    const cur = c?.connections.get(id);
    if (c && cur) c.connections.set(id, { ...cur, label: label || undefined });
  };
  const patchConnection = (id: string, p: Partial<Connection>) => {
    const c = connRef.current;
    const cur = c?.connections.get(id);
    if (c && cur) c.connections.set(id, { ...cur, ...p });
  };

  // --- Standalone lines ---
  const patchLine = (id: string, p: Partial<LineShape>) => {
    const c = connRef.current;
    const cur = c?.lines.get(id);
    if (c && cur) c.lines.set(id, { ...cur, ...p });
  };
  const removeLine = (id: string) => {
    connRef.current?.lines.delete(id);
    setSelectedLine((s) => (s === id ? null : s));
  };
  const setLineLabel = (id: string, label: string) =>
    patchLine(id, { label: label || undefined });

  // A valid drop target: topmost element under the point that isn't the source and isn't already
  // connected from the source in that direction.
  const linkTargetAt = (w: Pt, from: string): string | null => {
    const el = [...sizedElements]
      .reverse()
      .find(
        (e) =>
          e.id !== from &&
          !childToCol.has(e.id) &&
          w.x >= e.x &&
          w.x <= e.x + e.w &&
          w.y >= e.y &&
          w.y <= e.y + e.h,
      );
    if (!el) return null;
    const dup = Array.from(connRef.current?.connections.values() ?? []).some(
      (cn) => cn.from === from && cn.to === el.id,
    );
    return dup ? null : el.id;
  };
  const startLink = (from: string, e: React.PointerEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    setLinking({ from });
    setLinkEnd(toWorld(e.clientX, e.clientY));
    const reset = () => {
      setLinking(null);
      setLinkEnd(null);
      setLinkTarget(null);
    };
    startPointerDrag({
      onMove: (ev) => {
        const w = toWorld(ev.clientX, ev.clientY);
        setLinkEnd(w);
        setLinkTarget(linkTargetAt(w, from));
      },
      onUp: (ev) => {
        const target = linkTargetAt(toWorld(ev.clientX, ev.clientY), from);
        if (target) addConnection(from, target);
        reset();
      },
      onCancel: reset, // Esc: abandon the arrow
    });
  };

  // Drag a selected connection's endpoint to re-anchor it: the endpoint follows the cursor, and on
  // release it reassigns to whatever element is under the pointer (must differ from the other end).
  const startEndpointDrag = (
    id: string,
    which: "from" | "to",
    e: React.PointerEvent,
  ) => {
    if (readOnly) return;
    e.stopPropagation();
    setConnDrag({ id, which, pos: toWorld(e.clientX, e.clientY) });
    startPointerDrag({
      onMove: (ev) =>
        setConnDrag({ id, which, pos: toWorld(ev.clientX, ev.clientY) }),
      onUp: (ev) => {
        const w = toWorld(ev.clientX, ev.clientY);
        const cn = connRef.current?.connections.get(id);
        const target = [...sizedElements]
          .reverse()
          .find(
            (el) =>
              !childToCol.has(el.id) &&
              w.x >= el.x &&
              w.x <= el.x + el.w &&
              w.y >= el.y &&
              w.y <= el.y + el.h,
          );
        if (cn && target) {
          const other = which === "from" ? cn.to : cn.from;
          if (target.id !== other) patchConnection(id, { [which]: target.id });
        }
        setConnDrag(null);
      },
      onCancel: () => setConnDrag(null), // Esc: leave the endpoint where it was
    });
  };

  // Drag the midpoint handle to curve the line; releasing near the straight midpoint snaps it back.
  const startBendDrag = (id: string, e: React.PointerEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    const orig = connRef.current?.connections.get(id)?.bend;
    const apply = (clientX: number, clientY: number) => {
      const c = connRef.current;
      const cn = c?.connections.get(id);
      const from = elements.find((el) => el.id === cn?.from);
      const to = elements.find((el) => el.id === cn?.to);
      if (!cn || !from || !to) return;
      const mid = {
        x: (from.x + from.w / 2 + to.x + to.w / 2) / 2,
        y: (from.y + from.h / 2 + to.y + to.h / 2) / 2,
      };
      const w = toWorld(clientX, clientY);
      // ctrl ≈ 2*(handle - mid) so the curve's midpoint tracks the cursor.
      const bend = { x: 2 * (w.x - mid.x), y: 2 * (w.y - mid.y) };
      patchConnection(id, {
        bend: Math.hypot(bend.x, bend.y) < 8 ? undefined : bend,
      });
    };
    startPointerDrag({
      onMove: (ev) => apply(ev.clientX, ev.clientY),
      onCancel: () => patchConnection(id, { bend: orig }), // Esc: restore the original curve
    });
  };

  // Snap a pointer position to the nearest element anchor (corner / edge-mid / centre), else free.
  const snapEndpoint = (clientX: number, clientY: number): LineEndpoint => {
    const w = toWorld(clientX, clientY);
    const hit = nearestAnchor(
      w,
      sizedElements.filter((e) => !childToCol.has(e.id)),
      12 / zoom,
    );
    return hit
      ? { x: hit.pt.x, y: hit.pt.y, elementId: hit.elementId, anchor: hit.anchor }
      : { x: w.x, y: w.y };
  };
  // Drag a line endpoint: it follows the cursor and snaps/pins to an element anchor on release.
  const startLineEndpointDrag = (
    id: string,
    which: "a" | "b",
    e: React.PointerEvent,
  ) => {
    if (readOnly) return;
    e.stopPropagation();
    setLineDrag({ id, which, ep: snapEndpoint(e.clientX, e.clientY) });
    startPointerDrag({
      onMove: (ev) =>
        setLineDrag({ id, which, ep: snapEndpoint(ev.clientX, ev.clientY) }),
      onUp: (ev) => {
        patchLine(id, { [which]: snapEndpoint(ev.clientX, ev.clientY) });
        setLineDrag(null);
      },
      onCancel: () => setLineDrag(null), // Esc: keep the endpoint (only a preview moved)
    });
  };
  // Bend a line by dragging its midpoint handle (quadratic control); snaps back near straight.
  const startLineBendDrag = (id: string, e: React.PointerEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    const orig = connRef.current?.lines.get(id)?.bend;
    const byId = new Map(sizedElements.map((el) => [el.id, el]));
    const apply = (clientX: number, clientY: number) => {
      const ln = connRef.current?.lines.get(id);
      if (!ln) return;
      const a = resolveEnd(ln.a, byId);
      const b = resolveEnd(ln.b, byId);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const w = toWorld(clientX, clientY);
      const bend = { x: 2 * (w.x - mid.x), y: 2 * (w.y - mid.y) };
      patchLine(id, {
        bend: Math.hypot(bend.x, bend.y) < 8 ? undefined : bend,
      });
    };
    startPointerDrag({
      onMove: (ev) => apply(ev.clientX, ev.clientY),
      onCancel: () => patchLine(id, { bend: orig }), // Esc: restore the original curve
    });
  };

  // Line-tool draw, driven by the viewport pointer handlers in Canvas (which also do pan/marquee).
  const beginLineDraw = (clientX: number, clientY: number) => {
    const a = snapEndpoint(clientX, clientY);
    setLineDraw({ a, b: a });
  };
  const updateLineDraw = (clientX: number, clientY: number) =>
    setLineDraw((d) => (d ? { a: d.a, b: snapEndpoint(clientX, clientY) } : d));
  // Esc while drawing: discard the in-progress line and disarm the tool.
  const cancelLineDraw = () => {
    setLineDraw(null);
    setArmLine(false);
  };
  // Commit the line. A real drag uses the drawn endpoints; a click (no drag) drops a default
  // horizontal line of DEFAULT_LINE_LEN starting at the click. Disarms the tool either way.
  const commitLineDraw = () => {
    if (!lineDraw) return;
    const len = Math.hypot(
      lineDraw.b.x - lineDraw.a.x,
      lineDraw.b.y - lineDraw.a.y,
    );
    const a = lineDraw.a;
    const b =
      len > 8 ? lineDraw.b : { x: a.x + DEFAULT_LINE_LEN, y: a.y };
    const c = connRef.current;
    if (c) {
      const id = crypto.randomUUID();
      c.lines.set(id, { id, a, b, arrowStart: false, arrowEnd: false });
      setSelectedLine(id);
      setSelectedIds([]);
      setSelectedConn(null);
    }
    setLineDraw(null);
    setArmLine(false);
  };

  return {
    // selection (element selection lives in Canvas; edge selection lives here)
    selectedConn,
    setSelectedConn,
    selectedLine,
    setSelectedLine,
    editingConnLabel,
    setEditingConnLabel,
    editingLineLabel,
    setEditingLineLabel,
    // line tool
    armLine,
    setArmLine,
    lineDraw,
    // in-progress arrow drag (for the temp overlay)
    linking,
    linkEnd,
    linkTarget,
    // derived geometry
    connLines,
    lineGeo,
    snapPt,
    // connection ops
    addConnection,
    removeConnection,
    setConnectionLabel,
    patchConnection,
    // line ops
    patchLine,
    removeLine,
    setLineLabel,
    // drags
    startLink,
    startEndpointDrag,
    startBendDrag,
    startLineEndpointDrag,
    startLineBendDrag,
    // line drawing (used by the viewport pointer handlers)
    snapEndpoint,
    beginLineDraw,
    updateLineDraw,
    commitLineDraw,
    cancelLineDraw,
  };
}
