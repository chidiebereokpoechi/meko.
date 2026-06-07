import type { Peer } from "../../lib/board.ts";
import type { Element } from "../../types.ts";
import { WORLD_H, WORLD_W } from "./constants.ts";
import { CONN_DEFAULT, type ConnLine, type LineGeo, type Pt, connPath, edgePoint } from "./geometry.ts";

// A remote peer's live cursor, positioned in world coords but counter-scaled to stay constant size.
export function PeerCursor({ peer, zoom }: { peer: Peer; zoom: number }) {
  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-50"
      style={{ transform: `translate(${peer.cursor.x}px, ${peer.cursor.y}px) scale(${1 / zoom})`, transformOrigin: "top left" }}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="drop-shadow">
        <path d="M2 2l6 14 2.5-5.5L16 8 2 2z" fill={peer.color} stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <span className="ml-3 inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-bold text-white shadow" style={{ background: peer.color }}>
        {peer.name}
      </span>
    </div>
  );
}

// A draggable endpoint/bend handle (counter-scaled to stay constant size at any zoom).
export function Handle({ pt, zoom, bend, onPointerDown, onDoubleClick }: { pt: Pt; zoom: number; bend?: boolean; onPointerDown: (e: React.PointerEvent) => void; onDoubleClick?: () => void }) {
  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className={`absolute left-0 top-0 z-[7] cursor-grab rounded-full border-2 shadow active:cursor-grabbing ${bend ? "h-3 w-3 border-primary bg-primary/30" : "h-3.5 w-3.5 border-primary bg-white"}`}
      style={{ transform: `translate(${pt.x}px, ${pt.y}px) translate(-50%, -50%) scale(${1 / zoom})` }}
    />
  );
}

// In-place label / endpoint editor shared by connections and lines.
function EdgeLabel({ id, label, editing, readOnly, handle, zoom, onSelect, onLabelCommit }: { id: string; label?: string; editing: boolean; readOnly?: boolean; handle: Pt; zoom: number; onSelect: (id: string) => void; onLabelCommit: (id: string, label: string) => void }) {
  if (!editing && !label) return null;
  return (
    <div
      className="absolute left-0 top-0 z-[6]"
      style={{ transform: `translate(${handle.x}px, ${handle.y}px) translate(-50%, -50%) scale(${1 / zoom})` }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {editing ? (
        <input
          autoFocus
          defaultValue={label ?? ""}
          placeholder="Label"
          onBlur={(e) => onLabelCommit(id, e.target.value.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") onLabelCommit(id, label ?? "");
          }}
          className="w-28 rounded-md border-2 border-primary bg-white px-1.5 py-0.5 text-center text-[11px] font-bold text-slate-700 outline-none"
        />
      ) : readOnly ? (
        <span className="whitespace-nowrap rounded-md border-2 border-line-subtle bg-white px-1.5 py-0.5 text-[11px] font-bold text-slate-600 shadow-sm">{label}</span>
      ) : (
        <button onClick={() => onSelect(id)} className="whitespace-nowrap rounded-md border-2 border-line-subtle bg-white px-1.5 py-0.5 text-[11px] font-bold text-slate-600 shadow-sm">{label}</button>
      )}
    </div>
  );
}

// Standalone-line paths (behind elements). `draw` is the in-progress line being drawn.
export function LineLayer({ geo, draw, readOnly, selectedId, onSelect }: { geo: LineGeo[]; draw: { a: Pt; b: Pt } | null; readOnly?: boolean; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={WORLD_W} height={WORLD_H}>
      {geo.map(({ l, d }) => {
        const sel = l.id === selectedId;
        return (
          <g key={l.id} style={{ pointerEvents: readOnly ? "none" : "stroke", cursor: readOnly ? "default" : "pointer" }} onPointerDown={readOnly ? undefined : (e) => { e.stopPropagation(); onSelect(l.id); }}>
            <path d={d} fill="none" stroke="transparent" strokeWidth={16} />
            <path d={d} fill="none" stroke={l.color ?? CONN_DEFAULT} strokeWidth={(l.weight ?? 2) + (sel ? 1 : 0)} strokeDasharray={l.dashed ? "6 5" : undefined} markerStart={l.arrowStart ? "url(#conn-arrow-start)" : undefined} markerEnd={l.arrowEnd ? "url(#conn-arrow)" : undefined} />
          </g>
        );
      })}
      {draw && <path d={connPath(draw.a, draw.b, null)} fill="none" stroke="#6e24ff" strokeWidth={2} strokeDasharray="5 4" />}
    </svg>
  );
}

// Interactive overlay for standalone lines: endpoint handles (drag to move/pin), bend handle, label.
export function LineOverlay({ geo, zoom, readOnly, selectedId, editingId, snapPt, onSelect, onEndpointDown, onBendDown, onBendReset, onLabelCommit }: {
  geo: LineGeo[];
  zoom: number;
  readOnly?: boolean;
  selectedId: string | null;
  editingId: string | null;
  snapPt: Pt | null;
  onSelect: (id: string) => void;
  onEndpointDown: (id: string, which: "a" | "b", e: React.PointerEvent) => void;
  onBendDown: (id: string, e: React.PointerEvent) => void;
  onBendReset: (id: string) => void;
  onLabelCommit: (id: string, label: string) => void;
}) {
  return (
    <>
      {snapPt && (
        <div className="pointer-events-none absolute left-0 top-0 z-[8] h-4 w-4 rounded-full border-2 border-primary" style={{ transform: `translate(${snapPt.x}px, ${snapPt.y}px) translate(-50%, -50%) scale(${1 / zoom})` }} />
      )}
      {geo.map(({ l, a, b, handle }) => {
        const sel = l.id === selectedId && !readOnly;
        const editing = l.id === editingId && !readOnly;
        return (
          <div key={l.id}>
            {sel && (
              <>
                <Handle pt={a} zoom={zoom} onPointerDown={(e) => onEndpointDown(l.id, "a", e)} />
                <Handle pt={b} zoom={zoom} onPointerDown={(e) => onEndpointDown(l.id, "b", e)} />
                {!editing && <Handle pt={handle} zoom={zoom} bend onPointerDown={(e) => onBendDown(l.id, e)} onDoubleClick={() => onBendReset(l.id)} />}
              </>
            )}
            <EdgeLabel id={l.id} label={l.label} editing={editing} readOnly={readOnly} handle={handle} zoom={zoom} onSelect={onSelect} onLabelCommit={onLabelCommit} />
          </div>
        );
      })}
    </>
  );
}

// Arrow curves — rendered behind elements so a line tucks under its originating card.
export function ConnectionLines({ lines, temp, readOnly, selectedId, onSelect }: { lines: ConnLine[]; temp: { from: Element | null; end: Pt; target: Element | null } | null; readOnly?: boolean; selectedId: string | null; onSelect: (id: string) => void }) {
  // Preview starts at the source CENTRE; clings to a hovered target's edge, else follows the cursor.
  const tempStart = temp?.from ? { x: temp.from.x + temp.from.w / 2, y: temp.from.y + temp.from.h / 2 } : null;
  const tempEnd = temp ? (temp.target && tempStart ? edgePoint(temp.target, tempStart.x, tempStart.y) : temp.end) : null;
  return (
    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={WORLD_W} height={WORLD_H}>
      <defs>
        {/* context-stroke makes each arrowhead match its line colour; start head reverses. */}
        <marker id="conn-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="context-stroke" /></marker>
        <marker id="conn-arrow-start" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 Z" fill="context-stroke" /></marker>
      </defs>
      {lines.map(({ c, d }) => {
        const sel = c.id === selectedId;
        return (
          <g key={c.id} style={{ pointerEvents: readOnly ? "none" : "stroke", cursor: readOnly ? "default" : "pointer" }} onPointerDown={readOnly ? undefined : (e) => { e.stopPropagation(); onSelect(c.id); }}>
            <path d={d} fill="none" stroke="transparent" strokeWidth={16} />
            <path d={d} fill="none" stroke={c.color ?? CONN_DEFAULT} strokeWidth={(c.weight ?? 2) + (sel ? 1 : 0)} strokeDasharray={c.dashed ? "6 5" : undefined} markerStart={c.arrowStart ? "url(#conn-arrow-start)" : undefined} markerEnd={(c.arrowEnd ?? true) ? "url(#conn-arrow)" : undefined} />
          </g>
        );
      })}
      {tempStart && tempEnd && <path d={connPath(tempStart, tempEnd, null)} fill="none" stroke="#6e24ff" strokeWidth={2} strokeDasharray="5 4" markerEnd="url(#conn-arrow)" />}
    </svg>
  );
}

// Interactive overlay (above elements): endpoint handles for reassigning, and the in-place label.
export function ConnectionOverlay({ lines, zoom, readOnly, selectedId, editingId, onSelect, onEndpointDown, onBendDown, onBendReset, onLabelCommit }: {
  lines: ConnLine[];
  zoom: number;
  readOnly?: boolean;
  selectedId: string | null;
  editingId: string | null;
  onSelect: (id: string) => void;
  onEndpointDown: (id: string, which: "from" | "to", e: React.PointerEvent) => void;
  onBendDown: (id: string, e: React.PointerEvent) => void;
  onBendReset: (id: string) => void;
  onLabelCommit: (id: string, label: string) => void;
}) {
  return (
    <>
      {lines.map(({ c, p1, p2, handle }) => {
        const sel = c.id === selectedId && !readOnly;
        const editing = c.id === editingId && !readOnly;
        return (
          <div key={c.id}>
            {sel && (
              <>
                <Handle pt={p1} zoom={zoom} onPointerDown={(e) => onEndpointDown(c.id, "from", e)} />
                <Handle pt={p2} zoom={zoom} onPointerDown={(e) => onEndpointDown(c.id, "to", e)} />
                {!editing && <Handle pt={handle} zoom={zoom} bend onPointerDown={(e) => onBendDown(c.id, e)} onDoubleClick={() => onBendReset(c.id)} />}
              </>
            )}
            <EdgeLabel id={c.id} label={c.label} editing={editing} readOnly={readOnly} handle={handle} zoom={zoom} onSelect={onSelect} onLabelCommit={onLabelCommit} />
          </div>
        );
      })}
    </>
  );
}
