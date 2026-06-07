import type { ConnStatus } from "../../lib/board.ts";
import { Badge, Icon } from "../kit/index.ts";

type Marquee = { x0: number; y0: number; x1: number; y1: number };

// Fixed/absolute chrome that floats over the canvas viewport: the connection-status badge +
// comments toggle (top-right), the drag-over drop hint, the marquee selection rectangle, and the
// zoom control (bottom-left). Pure view; all state + actions come from Canvas.
export function CanvasChrome({
  status,
  showComments,
  unreadComments,
  onToggleComments,
  dragOver,
  marquee,
  zoom,
  onZoom,
}: {
  status: ConnStatus;
  showComments: boolean;
  unreadComments: boolean;
  onToggleComments: () => void;
  dragOver: boolean;
  marquee: Marquee | null;
  zoom: number;
  onZoom: (zoom: number) => void;
}) {
  return (
    <>
      <div
        className="absolute right-4 top-4 z-30 flex items-center gap-2"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Badge tone={status === "online" ? "green" : "slate"}>{status}</Badge>
        <button
          onClick={onToggleComments}
          aria-label="Comments"
          title="Comments"
          className={`relative grid h-8 w-8 place-items-center rounded-lg border-2 shadow-sm ${showComments ? "border-primary bg-primary text-white" : "border-line-subtle bg-white text-slate-500 hover:text-primary"}`}
        >
          <Icon.ChatIcon className="text-base" />
          {unreadComments && !showComments && (
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-primary" />
          )}
        </button>
      </div>
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 m-2 rounded-xl border-2 border-dashed border-primary bg-primary/5" />
      )}
      {/* Marquee selection rectangle (screen coords). */}
      {marquee && (
        <div
          className="pointer-events-none fixed z-40 rounded border-2 border-primary bg-primary/10"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}
      {/* Zoom control */}
      <div
        className="absolute bottom-4 left-4 z-30 flex items-center gap-1 rounded-lg border-2 border-line-subtle bg-white px-1 py-1 text-xs font-bold text-slate-500 shadow-sm"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          className="h-6 w-6 rounded hover:bg-slate-100"
          onClick={() => onZoom(zoom / 1.2)}
        >
          −
        </button>
        <button
          className="w-12 rounded hover:bg-slate-100"
          onClick={() => onZoom(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          className="h-6 w-6 rounded hover:bg-slate-100"
          onClick={() => onZoom(zoom * 1.2)}
        >
          +
        </button>
      </div>
    </>
  );
}
