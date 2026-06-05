import * as Y from "yjs";
import { API } from "./auth.ts";
import { api } from "./api.ts";
import type { Element } from "../types.ts";

export type ConnStatus = "connecting" | "online" | "offline";

// Live board connection. Matches the server WS protocol (src/index.ts): fetch a single-use ticket,
// open the socket, send {type:"auth",ticket} first, then exchange raw Yjs binary updates. The
// server sends full board state on join; we apply incoming updates with origin "remote" so our own
// update handler doesn't echo them back.
export class BoardConnection {
  readonly doc = new Y.Doc();
  readonly elements = this.doc.getMap<Element>("elements");
  onStatus?: (s: ConnStatus) => void;

  private ws: WebSocket | null = null;
  private closed = false;
  private synced = false;

  constructor(private boardId: string) {
    this.doc.on("update", this.onLocalUpdate);
  }

  private onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === "remote") return;
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
        if (typeof ev.data === "string") return; // control/error frames are JSON
        Y.applyUpdate(this.doc, new Uint8Array(ev.data as ArrayBuffer), "remote");
        if (!this.synced) {
          this.synced = true;
          this.onStatus?.("online");
          // Push any edits made while offline so the server (and peers) catch up.
          ws.send(Y.encodeStateAsUpdate(this.doc));
        }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        this.onStatus?.("offline");
        if (!this.closed) setTimeout(() => void this.connect(), 1500);
      };
    } catch {
      this.onStatus?.("offline");
      if (!this.closed) setTimeout(() => void this.connect(), 1500);
    }
  }

  destroy(): void {
    this.closed = true;
    this.doc.off("update", this.onLocalUpdate);
    this.ws?.close();
  }
}
