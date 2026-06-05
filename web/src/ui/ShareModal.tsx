import { useEffect, useState } from "react";
import { Button, Icon, Modal, TextField, toast } from "./kit/index.ts";
import {
  type InviteRole,
  type ShareLevel,
  type ShareLink,
  createInvite,
  createShareLink,
  inviteUrl,
  listShareLinks,
  revokeShareLink,
  shareUrl,
} from "../lib/sharing.ts";

const EXPIRY: { label: string; hours?: number }[] = [
  { label: "Never" },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
];

// Share a board (tokenised links, view/edit) and invite people to the workspace. Tokens are shown
// once on creation; we render the full web-origin URL for copy. There's no email delivery — the
// invite link is handed back to copy and send manually.
export function ShareModal({
  open,
  onClose,
  boardId,
  workspaceId,
  canInvite,
}: {
  open: boolean;
  onClose: () => void;
  boardId: string;
  workspaceId: string;
  canInvite: boolean;
}) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [level, setLevel] = useState<ShareLevel>("view");
  const [expiryIdx, setExpiryIdx] = useState(0);
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null); // last created full URL

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("editor");
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFresh(null);
    setInviteLink(null);
    listShareLinks(boardId).then(setLinks).catch(() => setLinks([]));
  }, [open, boardId]);

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast("Copied to clipboard", "success"),
      () => toast("Couldn't copy", "error"),
    );
  };

  const create = async () => {
    setCreating(true);
    try {
      const link = await createShareLink(boardId, level, EXPIRY[expiryIdx]!.hours);
      const url = shareUrl(link.token);
      setFresh(url);
      setLinks((l) => [{ id: link.id, level: link.level, expiresAt: link.expiresAt }, ...l]);
      copy(url);
    } catch {
      toast("Couldn't create link", "error");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await revokeShareLink(boardId, id);
      setLinks((l) => l.map((x) => (x.id === id ? { ...x, revokedAt: new Date().toISOString() } : x)));
    } catch {
      toast("Couldn't revoke", "error");
    }
  };

  const invite = async () => {
    setInviting(true);
    try {
      const inv = await createInvite(workspaceId, email.trim(), role);
      setInviteLink(inviteUrl(inv.token));
      setEmail("");
      toast("Invite link ready", "success");
    } catch {
      toast("Couldn't create invite", "error");
    } finally {
      setInviting(false);
    }
  };

  const active = links.filter((l) => !l.revokedAt);

  return (
    <Modal open={open} onClose={onClose} title="Share board">
      {/* Create a share link */}
      <div className="grid gap-2">
        <div className="flex gap-2">
          <Segment value={level} onChange={setLevel} options={[{ v: "view", label: "Can view" }, { v: "edit", label: "Can edit" }]} />
        </div>
        <label className="grid gap-1.5">
          <span className="text-xs text-slate-400">Expires</span>
          <select
            value={expiryIdx}
            onChange={(e) => setExpiryIdx(Number(e.target.value))}
            className="rounded-lg border-2 border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-primary focus:ring-4 focus:ring-primary/20"
          >
            {EXPIRY.map((o, i) => (
              <option key={o.label} value={i}>{o.label}</option>
            ))}
          </select>
        </label>
        <Button onClick={create} loading={creating}>
          <Icon.ShareIcon className="text-base" /> Create link
        </Button>
        {fresh && (
          <div className="flex items-center gap-1 rounded-lg border-2 border-slate-100 bg-slate-50 p-1">
            <input readOnly value={fresh} className="min-w-0 flex-1 bg-transparent px-2 text-xs text-slate-500 outline-none" />
            <Button variant="ghost" onClick={() => copy(fresh)}>Copy</Button>
          </div>
        )}
      </div>

      {/* Existing links */}
      {active.length > 0 && (
        <div className="grid gap-1 border-t-2 border-slate-100 pt-3">
          <span className="text-xs font-bold text-slate-400">Active links</span>
          {active.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                {l.level === "edit" ? "Can edit" : "Can view"}
                {l.expiresAt && <span className="text-slate-400"> · expires {new Date(l.expiresAt).toLocaleDateString()}</span>}
              </span>
              <button onClick={() => revoke(l.id)} className="rounded-md px-2 py-1 font-bold text-red-500 hover:bg-red-50">Revoke</button>
            </div>
          ))}
        </div>
      )}

      {/* Workspace invite */}
      {canInvite && (
        <div className="grid gap-2 border-t-2 border-slate-100 pt-3">
          <span className="text-xs font-bold text-slate-400">Invite to workspace</span>
          <TextField label="Email" name="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div className="flex items-center gap-2">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as InviteRole)}
              className="rounded-lg border-2 border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-primary focus:ring-4 focus:ring-primary/20"
            >
              <option value="admin">Admin</option>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
            <Button className="flex-1" onClick={invite} loading={inviting} disabled={!email.trim()}>Create invite</Button>
          </div>
          {inviteLink && (
            <div className="flex items-center gap-1 rounded-lg border-2 border-slate-100 bg-slate-50 p-1">
              <input readOnly value={inviteLink} className="min-w-0 flex-1 bg-transparent px-2 text-xs text-slate-500 outline-none" />
              <Button variant="ghost" onClick={() => copy(inviteLink)}>Copy</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Segment<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; label: string }[] }) {
  return (
    <div className="flex w-full rounded-lg border-2 border-slate-200 p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${value === o.v ? "bg-primary text-white" : "text-slate-500 hover:bg-slate-100"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
