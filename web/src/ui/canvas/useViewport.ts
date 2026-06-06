import { useEffect, useRef, useState, type RefObject } from "react";
import { WORLD_H, WORLD_W } from "./constants.ts";

export type View = { x: number; y: number; zoom: number };
type Box = { x: number; y: number; w: number; h: number };

const clampZoom = (z: number) => Math.min(3, Math.max(0.2, z));

// Pan/zoom viewport: the world is a fixed WORLD_W×WORLD_H surface translated+scaled into the
// clipping viewport. Owns view state, screen→world conversion, clamping, wheel pan/zoom, and the
// Space-to-pan flag. Pointer drag (pan/marquee) stays in the canvas but uses panRef/spaceRef here.
export function useViewport(viewportRef: RefObject<HTMLDivElement>, surfaceRef: RefObject<HTMLDivElement>) {
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const panRef = useRef<{ cx: number; cy: number; px: number; py: number } | null>(null);
  const spaceRef = useRef(false);

  // Screen point → world coords. The surface's bounding rect already reflects the pan/zoom.
  const toWorld = (clientX: number, clientY: number) => {
    const r = surfaceRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (clientX - r.left) / view.zoom, y: (clientY - r.top) / view.zoom };
  };
  // World point ~centred in the viewport (offset to roughly centre a default note).
  const viewportCentre = () => {
    const r = viewportRef.current?.getBoundingClientRect();
    if (!r) return { x: 200, y: 200 };
    const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    return { x: c.x - 110, y: c.y - 60 };
  };

  // Clamp pan so the world can't be dragged out of view; centre it when smaller than the viewport.
  const clampView = (v: View): View => {
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!vp) return v;
    const axis = (pos: number, world: number, viewSize: number) =>
      world <= viewSize ? (viewSize - world) / 2 : Math.min(0, Math.max(viewSize - world, pos));
    return { zoom: v.zoom, x: axis(v.x, WORLD_W * v.zoom, vp.width), y: axis(v.y, WORLD_H * v.zoom, vp.height) };
  };
  const setViewClamped = (fn: (v: View) => View) => setView((v) => clampView(fn(v)));

  // Zoom toward a screen point, keeping that point fixed in world space.
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const r = viewportRef.current?.getBoundingClientRect();
    if (!r) return;
    setViewClamped((v) => {
      const z = clampZoom(v.zoom * factor);
      const k = z / v.zoom;
      const px = clientX - r.left;
      const py = clientY - r.top;
      return { zoom: z, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  };
  const setZoom = (z: number) => {
    const r = viewportRef.current?.getBoundingClientRect();
    if (r) zoomAt(r.left + r.width / 2, r.top + r.height / 2, clampZoom(z) / view.zoom);
  };
  const resetView = () => setView(clampView({ zoom: 1, x: 0, y: 0 }));
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
    setView(clampView({ zoom, x: (vp.width - bw * zoom) / 2 - minX * zoom, y: (vp.height - bh * zoom) / 2 - minY * zoom }));
  };

  // Wheel: ⌘/Ctrl (or pinch) zooms toward the cursor; otherwise pans. Native listener so we can
  // preventDefault (React's onWheel is passive).
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
  }, [view.zoom]);

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

  return { view, setView, panRef, spaceRef, toWorld, viewportCentre, clampView, setViewClamped, zoomAt, setZoom, resetView, zoomToFit };
}
