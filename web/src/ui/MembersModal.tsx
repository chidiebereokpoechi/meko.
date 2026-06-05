import { useEffect, useState } from "react";
import { Button, Icon, Modal, Select, TextField, toast } from "./kit/index.ts";
import {
  type Member,
  type PendingInvite,
  listInvites,
  listMembers,
  removeMember,
  revokeInvite,
  setMemberRole,
} from "../lib/members.ts";
import { type InviteRole, createInvite, inviteUrl } from "../lib/sharing.ts";

const ROLE_OPTIONS: { value: InviteRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
];

// Manage workspace members (change role / remove) and pending invites (revoke). Owner row is
// immutable. canManage gates every mutation; non-managers get a read-only roster.
export function MembersModal({
  open,
  onClose,
  workspaceId,
  canManage,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  canManage: boolean;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("editor");
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setInviteLink(null);
    setEmail("");
    listMembers(workspaceId).then(setMembers).catch(() => setMembers([]));
    if (canManage) listInvites(workspaceId).then(setInvites).catch(() => setInvites([]));
  }, [open, workspaceId, canManage]);

  const invite = async () => {
    setInviting(true);
    try {
      const inv = await createInvite(workspaceId, email.trim(), role);
      setInviteLink(inviteUrl(inv.token));
      setEmail("");
      listInvites(workspaceId).then(setInvites).catch(() => {});
      toast("Invite link ready", "success");
    } catch {
      toast("Couldn't create invite", "error");
    } finally {
      setInviting(false);
    }
  };

  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).then(
      () => toast("Copied to clipboard", "success"),
      () => toast("Couldn't copy", "error"),
    );

  const changeRole = async (userId: string, role: InviteRole) => {
    const prev = members;
    setMembers((m) => m.map((x) => (x.userId === userId ? { ...x, role } : x)));
    try {
      await setMemberRole(workspaceId, userId, role);
    } catch {
      setMembers(prev);
      toast("Couldn't change role", "error");
    }
  };

  const remove = async (userId: string) => {
    const prev = members;
    setMembers((m) => m.filter((x) => x.userId !== userId));
    try {
      await removeMember(workspaceId, userId);
      toast("Member removed", "success");
    } catch {
      setMembers(prev);
      toast("Couldn't remove member", "error");
    }
  };

  const revoke = async (id: string) => {
    setInvites((i) => i.filter((x) => x.id !== id));
    try {
      await revokeInvite(workspaceId, id);
    } catch {
      toast("Couldn't revoke invite", "error");
      listInvites(workspaceId).then(setInvites).catch(() => {});
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Members">
      {canManage && (
        <div className="grid gap-2 border-b-2 border-slate-100 pb-3">
          <span className="text-xs font-bold text-slate-400">Invite people</span>
          <TextField label="Email" name="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div className="flex items-end gap-2">
            <Select name="invite-role" value={role} options={ROLE_OPTIONS} onChange={setRole} className="w-28" />
            <Button className="flex-1 border-2 border-transparent" onClick={invite} loading={inviting} disabled={!email.trim()}>Create invite</Button>
          </div>
          {inviteLink && (
            <div className="flex items-center gap-1 rounded-lg border-2 border-slate-100 bg-slate-50 p-1">
              <input readOnly value={inviteLink} className="min-w-0 flex-1 bg-transparent px-2 text-xs text-slate-500 outline-none" />
              <Button variant="ghost" onClick={() => copy(inviteLink)}>Copy</Button>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-1">
        {members.map((m) => (
          <div key={m.userId} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-bold text-slate-700">{m.displayName}</div>
              <div className="truncate text-xs text-slate-400">{m.email}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {m.role === "owner" || !canManage ? (
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold capitalize text-slate-500">{m.role}</span>
              ) : (
                <>
                  <Select value={m.role as InviteRole} options={ROLE_OPTIONS} onChange={(r) => changeRole(m.userId, r)} className="w-28" />
                  <button onClick={() => remove(m.userId)} aria-label="Remove" title="Remove" className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500">
                    <Icon.TrashIcon className="text-base" />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {canManage && invites.length > 0 && (
        <div className="grid gap-1 border-t-2 border-slate-100 pt-3">
          <span className="text-xs font-bold text-slate-400">Pending invites</span>
          {invites.map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-2 text-xs">
              <div className="min-w-0">
                <span className="truncate font-bold text-slate-600">{i.email}</span>
                <span className="text-slate-400"> · {i.role}</span>
              </div>
              <button onClick={() => revoke(i.id)} className="rounded-md px-2 py-1 font-bold text-red-500 hover:bg-red-50">Revoke</button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
