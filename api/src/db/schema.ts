import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigserial,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Postgres bytea — Yjs updates/snapshots are raw binary, not text.
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (v) => Buffer.from(v),
  fromDriver: (v) => new Uint8Array(v),
});

const now = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

// --- Identity ---

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  // Argon2id hash; nullable so future OAuth-only accounts can exist without a password.
  passwordHash: text("password_hash"),
  createdAt: now(),
}, (t) => [uniqueIndex("users_email_idx").on(t.email)]);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  createdAt: now(),
});

export const roleEnum = pgEnum("member_role", ["owner", "admin", "editor", "viewer"]);

export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull().default("viewer"),
  createdAt: now(),
}, (t) => [
  // Permission-check hot path (§13b).
  uniqueIndex("members_workspace_user_idx").on(t.workspaceId, t.userId),
]);

// --- Boards ---

export const boards = pgTable("boards", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  // Parent board for nested boards; null = top-level (the only ones listed at the workspace level).
  parentBoardId: uuid("parent_board_id").references((): AnyPgColumn => boards.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Untitled"),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  // Board list by workspace, newest first (§13b).
  index("boards_workspace_updated_idx").on(t.workspaceId, t.updatedAt.desc()),
  // Children of a board (nested-board navigation).
  index("boards_parent_idx").on(t.parentBoardId),
]);

export const permLevelEnum = pgEnum("perm_level", ["view", "edit"]);

export const boardPermissions = pgTable("board_permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  level: permLevelEnum("level").notNull().default("view"),
  createdAt: now(),
}, (t) => [
  // Board-level permission lookup (§13b).
  uniqueIndex("board_permissions_board_user_idx").on(t.boardId, t.userId),
]);

export const comments = pgTable("comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: now(),
}, (t) => [index("comments_board_created_idx").on(t.boardId, t.createdAt.desc())]);

// --- Yjs persistence (§5c/5h/5i) ---

// Incremental CRDT updates. Compacted into a snapshot and pruned periodically.
export const yjsUpdates = pgTable("yjs_updates", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  update: bytea("update").notNull(),
  createdAt: now(),
}, (t) => [index("yjs_updates_board_idx").on(t.boardId, t.id)]);

// Materialised board state. Keep MEKO_SNAPSHOT_RETENTION most-recent per board for fallback.
export const yjsSnapshots = pgTable("yjs_snapshots", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  snapshot: bytea("snapshot").notNull(),
  createdAt: now(),
}, (t) => [index("yjs_snapshots_board_idx").on(t.boardId, t.id.desc())]);

// --- Auth (§9g/9h) ---

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  deviceHint: text("device_hint"),
  ipHint: text("ip_hint"),
  usedAt: timestamp("used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: now(),
}, (t) => [
  uniqueIndex("refresh_tokens_hash_idx").on(t.tokenHash),
  index("refresh_tokens_family_idx").on(t.familyId),
  // Expired-token cleanup (§13b).
  index("refresh_tokens_expires_idx").on(t.expiresAt).where(sql`revoked_at IS NULL`),
]);

// --- Jobs (§12n/12o) ---

export const jobStatusEnum = pgEnum("job_status", ["pending", "running", "done", "failed", "dead"]);

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  status: jobStatusEnum("status").notNull().default("pending"),
  priority: integer("priority").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  // Eligibility gate for backoff requeues — a job is claimable only once run_after has passed.
  runAfter: timestamp("run_after", { withTimezone: true }).defaultNow().notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  error: text("error"),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  // Covering index for the worker claim query (§13b).
  index("jobs_claim_idx").on(t.priority.desc(), t.runAfter).where(sql`status = 'pending'`),
  // Reaper: find expired claims.
  index("jobs_reaper_idx").on(t.claimExpiresAt).where(sql`status = 'running'`),
]);

// --- Exports (§8) ---

export const exportFormatEnum = pgEnum("export_format", ["png", "pdf"]);
export const exportStatusEnum = pgEnum("export_status", ["pending", "running", "ready", "failed"]);

export const boardExports = pgTable("exports", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  requestedBy: uuid("requested_by").notNull().references(() => users.id),
  format: exportFormatEnum("format").notNull(),
  status: exportStatusEnum("status").notNull().default("pending"),
  resultKey: text("result_key"),
  error: text("error"),
  createdAt: now(),
}, (t) => [index("exports_board_idx").on(t.boardId, t.createdAt.desc())]);

// --- Idempotency & audit ---

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  responseHash: text("response_hash"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: now(),
}, (t) => [index("idempotency_keys_expires_idx").on(t.expiresAt)]);

// --- Sharing (§9) ---

// Tokenised board access. The raw token is shown once at creation; only its hash is stored.
// Redeeming (while signed in) upserts a board_permissions row for the redeemer.
export const shareLinks = pgTable("share_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  level: permLevelEnum("level").notNull().default("view"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: now(),
}, (t) => [
  uniqueIndex("share_links_hash_idx").on(t.tokenHash),
  index("share_links_board_idx").on(t.boardId),
]);

// Workspace invites by email. Accepting (while signed in) adds the redeemer as a member.
export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: roleEnum("role").notNull().default("editor"),
  tokenHash: text("token_hash").notNull(),
  invitedBy: uuid("invited_by").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: now(),
}, (t) => [
  uniqueIndex("invites_hash_idx").on(t.tokenHash),
  index("invites_workspace_idx").on(t.workspaceId),
]);

// --- Link unfurls (§7) ---

// Cache of unfurl results keyed by URL. resolvedIp is stored at unfurl time so reads never
// re-resolve DNS (§7e); a manual refresh re-runs ssrfSafeUrl against current DNS. Only http(s)
// URLs are ever written here (SafeUrl validated at the route).
export const unfurls = pgTable("unfurls", {
  url: text("url").primaryKey(),
  title: text("title"),
  description: text("description"),
  imageUrl: text("image_url"),
  resolvedIp: text("resolved_ip"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- Media (§6) ---

export const mediaStatusEnum = pgEnum("media_status", ["pending", "ready", "failed"]);

export const media = pgTable("media", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  status: mediaStatusEnum("status").notNull().default("pending"),
  // Client-declared content type at presign time; the worker re-sniffs the actual bytes (§6e).
  declaredType: text("declared_type").notNull(),
  // Raw client upload; for SVG this is the download-only original (edit-gated).
  originalKey: text("original_key").notNull(),
  // Sanitised, re-encoded derivative an element's src resolves to.
  displayKey: text("display_key"),
  thumbKey: text("thumb_key"),
  bytes: integer("bytes"),
  error: text("error"),
  createdAt: now(),
}, (t) => [index("media_board_idx").on(t.boardId, t.createdAt.desc())]);

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(),
  resource: text("resource"),
  detail: jsonb("detail"),
  createdAt: now(),
}, (t) => [index("audit_log_workspace_created_idx").on(t.workspaceId, t.createdAt.desc())]);
