import * as Y from "yjs";
import { API } from "./auth.ts";
import { api } from "./api.ts";
import type { Connection, Element, LineShape } from "../types.ts";

export type ConnStatus = "connecting" | "online" | "offline";

export interface Peer {
  clientId: string;
  userId: string;
  name: string;
  color: string;
  cursor: { x: number; y: number };
}

// Live board connection. Matches the server WS protocol (src/index.ts): fetch a single-use ticket,
// open the socket, send {type:"auth",ticket} first, then exchange raw Yjs binary updates. The
// server sends full board state on join; we apply incoming updates with origin "remote" so our own
// update handler doesn't echo them back.
export class BoardConnection {
  readonly doc = new Y.Doc();
  readonly elements = this.doc.getMap<Element>("elements");
  // Directed links between elements (arrows), keyed by id. Lives in the same doc so it syncs and
  // undoes alongside elements.
  readonly connections = this.doc.getMap<Connection>("connections");
  // Standalone lines (not tied to two elements; endpoints may pin to element anchors).
  readonly lines = this.doc.getMap<LineShape>("lines");
  // Undo/redo over local edits only — remote updates are applied with origin "remote", which the
  // UndoManager (default trackedOrigins = null/local) ignores, so undo never reverts peers' work.
  readonly undoMgr = new Y.UndoManager([this.elements, this.connections, this.lines]);
  onStatus?: (s: ConnStatus) => void;

  // Live peer cursors, keyed by server-assigned clientId. Ephemeral — never persisted.
  readonly peers = new Map<string, Peer>();
  onPresence?: (peers: Peer[]) => void;
  // Fired when a peer posts a comment (server pushes a signal; the panel refetches the thread).
  onComment?: () => void;
  // Fired with the authoritative edit permission once the server's hello arrives (viewers: false).
  onAccess?: (canEdit: boolean) => void;
  private lastCursorSent = 0;
  private selfUserId: string | null = null;

  undo() {
    this.undoMgr.undo();
  }
  redo() {
    this.undoMgr.redo();
  }

  private ws: WebSocket | null = null;
  private closed = false;
  private synced = false;
  private canEdit = false;

  constructor(private boardId: string) {
    this.doc.on("update", this.onLocalUpdate);
  }

  private onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === "remote") return;
    if (!this.canEdit) return; // viewers never push; the server rejects them anyway
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(update);
  };

  async connect(): Promise<void> {
    if (this.closed) return;
    this.onStatus?.("connecting");
    try {
      const { ticket } = await api<{ ticket: string }>("/api/ws-ticket", { method: "POST" });
      const ws = new WebSocket(`${API.replace(/^http/, "ws")}/boards/${this.boardId}`);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      this.synced = false;

      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", ticket }));
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          this.onControlFrame(ev.data);
          return;
        }
        Y.applyUpdate(this.doc, new Uint8Array(ev.data as ArrayBuffer), "remote");
        if (!this.synced) {
          this.synced = true;
          this.onStatus?.("online");
          // Push any edits made while offline so the server (and peers) catch up (editors only).
          if (this.canEdit) ws.send(Y.encodeStateAsUpdate(this.doc));
        }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        this.onStatus?.("offline");
        if (this.peers.size) {
          this.peers.clear();
          this.onPresence?.([]);
        }
        if (!this.closed) setTimeout(() => void this.connect(), 1500);
      };
    } catch {
      this.onStatus?.("offline");
      if (!this.closed) setTimeout(() => void this.connect(), 1500);
    }
  }

  // Parse a JSON control frame: error, or peer presence/leave. Unknown frames are ignored.
  private onControlFrame(raw: string): void {
    let m: { type?: string; clientId?: string } & Partial<Peer>;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.type === "hello") {
      this.selfUserId = m.userId ?? null;
      this.canEdit = (m as { canEdit?: boolean }).canEdit ?? false;
      this.onAccess?.(this.canEdit);
      return;
    }
    if (m.type === "comment") {
      this.onComment?.();
      return;
    }
    if (m.type === "presence" && m.clientId && m.cursor) {
      if (m.userId && m.userId === this.selfUserId) return; // don't show our own cursor (any tab)
      this.peers.set(m.clientId, {
        clientId: m.clientId,
        userId: m.userId ?? "",
        name: m.name ?? "Someone",
        color: m.color ?? "#6e24ff",
        cursor: m.cursor,
      });
      this.onPresence?.([...this.peers.values()]);
    } else if (m.type === "presence-leave" && m.clientId) {
      if (this.peers.delete(m.clientId)) this.onPresence?.([...this.peers.values()]);
    }
  }

  // Broadcast this client's cursor in world coordinates. Throttled to ~30fps to bound WS traffic.
  sendCursor(x: number, y: number): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    if (now - this.lastCursorSent < 33) return;
    this.lastCursorSent = now;
    this.ws.send(JSON.stringify({ type: "presence", cursor: { x, y } }));
  }

  destroy(): void {
    this.closed = true;
    this.doc.off("update", this.onLocalUpdate);
    this.ws?.close();
  }
}
