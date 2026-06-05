import * as Y from "yjs";
import { config } from "@/config.ts";
import { ctxLog } from "@/lib/logger.ts";
import { appendUpdate, compactBoard, loadDoc } from "@/realtime/persistence.ts";
import { publishUpdate, startRoomSubscriber } from "@/realtime/room-sync.ts";

// Framework-agnostic view of a connected socket so the room manager doesn't depend on Elysia.
export interface LocalClient {
  id: string;
  sendBinary(data: Uint8Array): void;
  sendError(code: string, message: string): void;
}

interface Room {
  boardId: string;
  doc: Y.Doc;
  clients: Map<string, LocalClient>;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private started = false;

  // Wire the cross-node subscriber exactly once (§3e).
  start(): void {
    if (this.started) return;
    this.started = true;
    startRoomSubscriber((boardId, update) => this.onRemoteUpdate(boardId, update));
  }

  private async getOrCreate(boardId: string): Promise<Room> {
    let room = this.rooms.get(boardId);
    if (room) return room;
    // First local client for this board: hydrate from Postgres, never from Redis (§3e).
    const doc = await loadDoc(boardId);
    room = { boardId, doc, clients: new Map() };
    this.rooms.set(boardId, room);
    return room;
  }

  // A client joins: register it and send the current full state as the initial sync.
  async join(boardId: string, client: LocalClient): Promise<void> {
    const room = await this.getOrCreate(boardId);
    room.clients.set(client.id, client);
    client.sendBinary(Y.encodeStateAsUpdate(room.doc));
  }

  // Last-client-leave fires compaction (§5c). Drop the in-memory doc to free memory.
  async leave(boardId: string, clientId: string): Promise<void> {
    const room = this.rooms.get(boardId);
    if (!room) return;
    room.clients.delete(clientId);
    if (room.clients.size === 0) {
      this.rooms.delete(boardId);
      compactBoard(boardId).catch((err) =>
        ctxLog().error({ err, action: "yjs.compact_fail", boardId }, "compaction failed"),
      );
    }
  }

  // Inbound update from a local client. Size-gate (§4e), persist, fan out locally, publish.
  async applyLocalUpdate(boardId: string, update: Uint8Array, originId: string): Promise<void> {
    const room = this.rooms.get(boardId);
    if (!room) return;

    if (!this.withinSizeLimit(room, update, originId)) return; // gate rejected; client notified

    Y.applyUpdate(room.doc, update);
    await appendUpdate(boardId, update);
    this.broadcastLocal(room, update, originId);
    await publishUpdate(boardId, update);
  }

  // Remote update from another node: apply locally and fan out to local clients (§3e).
  private onRemoteUpdate(boardId: string, update: Uint8Array): void {
    const room = this.rooms.get(boardId);
    if (!room) return; // no local clients for this board; ignore
    Y.applyUpdate(room.doc, update);
    this.broadcastLocal(room, update, null);
  }

  private broadcastLocal(room: Room, update: Uint8Array, exceptId: string | null): void {
    for (const [id, client] of room.clients) {
      if (id === exceptId) continue;
      client.sendBinary(update);
    }
  }

  // Project the post-apply doc size against MEKO_MAX_BOARD_BYTES (§4e). Reject if over; warn
  // at 80%. Uses a scratch copy so a rejected update never mutates the live doc.
  private withinSizeLimit(room: Room, update: Uint8Array, originId: string): boolean {
    const scratch = new Y.Doc();
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(room.doc));
    Y.applyUpdate(scratch, update);
    const projected = Y.encodeStateAsUpdate(scratch).byteLength;
    const limit = config.MEKO_MAX_BOARD_BYTES;

    if (projected > limit) {
      ctxLog().warn({ action: "yjs.doc_too_large", projected, limit }, "rejected oversized update");
      room.clients.get(originId)?.sendError("doc_too_large", "Board size limit reached");
      return false;
    }
    if (projected > limit * 0.8) {
      ctxLog().warn({ action: "yjs.doc_near_limit", projected, limit }, "board approaching size limit");
    }
    return true;
  }
}

export const roomManager = new RoomManager();
