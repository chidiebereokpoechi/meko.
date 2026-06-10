import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { WORLD_H, WORLD_W } from "./constants.ts";

export type View = { x: number; y: number; zoom: number };
type Box = { x: number; y: number; w: number; h: number };

const clampZoom = (z: number) => Math.min(3, Math.max(0.2, z));

// How long after the last pan/wheel event the live view is committed to React state.
const COMMIT_MS = 120;

// Pan/zoom viewport: the world is a fixed WORLD_W×WORLD_H surface translated+scaled into the
// clipping viewport. Owns view state, screen→world conversion, clamping, wheel pan/zoom, and the
// Space-to-pan flag. Pointer drag (pan/marquee) stays in the canvas but uses panRef/spaceRef here.
//
// Perf-critical: the live view lives in `viewRef` and every pan/zoom event writes the surface's
// `style.transform` directly — React never renders on the gesture's hot path. The committed `view`
// state (which re-renders the canvas: zoom %, overlay handle sizes, card resize math) only updates
// when a gesture settles. Anything that needs the *current* view mid-gesture (toWorld, pan anchors)
// must read `viewRef`, not `view`.
export function useViewport(viewportRef: RefObject<HTMLDivElement>, surfaceRef: RefObject<HTMLDivElement>) {
  const viewRef = useRef<View>({ x: 0, y: 0, zoom: 1 });
  const [view, setView] = useState<View>(viewRef.current);
  const commitTimer = useRef<number | null>(null);
  const panRef = useRef<{ cx: number; cy: number; px: number; py: number } | null>(null);
  const spaceRef = useRef(false);

  // Screen point → world coords. The surface's bounding rect already reflects the pan/zoom (the
  // transform is written to the DOM synchronously), so this stays correct mid-gesture.
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const r = surfaceRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    const z = viewRef.current.zoom;
    return { x: (clientX - r.left) / z, y: (clientY - r.top) / z };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // World point ~centred in the viewport (offset to roughly centre a default note).
  const viewportCentre = useCallback(() => {
    const r = viewportRef.current?.getBoundingClientRect();
    if (!r) return { x: 200, y: 200 };
    const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    return { x: c.x - 110, y: c.y - 60 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toWorld]);

  // Clamp pan so the world can't be dragged out of view; centre it when smaller than the viewport.
  const clampView = useCallback((v: View): View => {
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!vp) return v;
    const axis = (pos: number, world: number, viewSize: number) =>
      world <= viewSize ? (viewSize - world) / 2 : Math.min(0, Math.max(viewSize - world, pos));
    return { zoom: v.zoom, x: axis(v.x, WORLD_W * v.zoom, vp.width), y: axis(v.y, WORLD_H * v.zoom, vp.height) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply a view: clamp, write the surface transform straight to the DOM, then commit to React
  // state — immediately for discrete jumps (buttons, zoom-to-fit), trailing for gesture streams
  // (pan/wheel) so the canvas re-renders once per gesture instead of once per event.
  const applyView = useCallback(
    (v: View, commit: "now" | "trailing") => {
      const cl = clampView(v);
      viewRef.current = cl;
      const s = surfaceRef.current;
      if (s) s.style.transform = `translate(${cl.x}px, ${cl.y}px) scale(${cl.zoom})`;
      if (commitTimer.current != null) {
        clearTimeout(commitTimer.current);
        commitTimer.current = null;
      }
      if (commit === "now") setView(cl);
      else
        commitTimer.current = window.setTimeout(() => {
          commitTimer.current = null;
          setView(viewRef.current);
        }, COMMIT_MS);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clampView],
  );
  const setViewClamped = useCallback(
    (fn: (v: View) => View) => applyView(fn(viewRef.current), "trailing"),
    [applyView],
  );
  // Commit the live view to state right now (e.g. on pan pointerup, instead of the trailing timer).
  const commitView = useCallback(() => applyView(viewRef.current, "now"), [applyView]);

  // The transform is owned imperatively (never in JSX style), so a React render mid-gesture can't
  // snap the surface back to a stale committed view. Seed it on mount.
  useLayoutEffect(() => {
    const v = viewRef.current;
    const s = surfaceRef.current;
    if (s) s.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
    return () => {
      if (commitTimer.current != null) clearTimeout(commitTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zoom toward a screen point, keeping that point fixed in world space.
  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number, commit: "now" | "trailing" = "trailing") => {
      const r = viewportRef.current?.getBoundingClientRect();
      if (!r) return;
      const v = viewRef.current;
      const z = clampZoom(v.zoom * factor);
      const k = z / v.zoom;
      const px = clientX - r.left;
      const py = clientY - r.top;
      applyView({ zoom: z, x: px - (px - v.x) * k, y: py - (py - v.y) * k }, commit);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyView],
  );
  const setZoom = (z: number) => {
    const r = viewportRef.current?.getBoundingClientRect();
    if (r) zoomAt(r.left + r.width / 2, r.top + r.height / 2, clampZoom(z) / viewRef.current.zoom, "now");
  };
  const resetView = () => applyView({ zoom: 1, x: 0, y: 0 }, "now");
  // Frame the given boxes' bounding rect (with padding); reset if none.
  const zoomToFit = (boxes: Box[]) => {
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!vp || boxes.length === 0) return resetView();
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.w));
    const maxY = Math.max(...boxes.map((b) => b.y + b.h));
    const pad = 80;
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const zoom = clampZoom(Math.min((vp.width - pad * 2) / bw, (vp.height - pad * 2) / bh));
    applyView({ zoom, x: (vp.width - bw * zoom) / 2 - minX * zoom, y: (vp.height - bh * zoom) / 2 - minY * zoom }, "now");
  };

  // Wheel: ⌘/Ctrl (or pinch) zooms toward the cursor; otherwise pans. Native listener so we can
  // preventDefault (React's onWheel is passive). Bound once — handlers read viewRef, never state.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
      else setViewClamped((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track Space to switch empty-drag from marquee to pan.
  useEffect(() => {
    const set = (down: boolean) => (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = down;
    };
    const d = set(true);
    const u = set(false);
    window.addEventListener("keydown", d);
    window.addEventListener("keyup", u);
    return () => {
      window.removeEventListener("keydown", d);
      window.removeEventListener("keyup", u);
    };
  }, []);

  return { view, viewRef, panRef, spaceRef, toWorld, viewportCentre, clampView, setViewClamped, commitView, zoomAt, setZoom, resetView, zoomToFit };
}
