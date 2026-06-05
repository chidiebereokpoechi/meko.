import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.ts";
import { acceptInvite, acceptShare } from "../lib/sharing.ts";
import type { Board } from "../types.ts";
import { toast } from "./kit/index.ts";

// Landing page for a share/invite link: redeems the token (requires being signed in — the app
// gates on auth before this mounts, preserving the URL), then routes into the granted board or
// workspace. reload refreshes the workspace list so a freshly-joined workspace shows up.
export function AcceptToken({ kind, reload }: { kind: "share" | "invite"; reload: () => Promise<unknown> }) {
  const { token } = useParams();
  const navigate = useNavigate();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !token) return;
    ran.current = true;
    (async () => {
      try {
        if (kind === "share") {
          const { boardId } = await acceptShare(token);
          const board = await api<Board>(`/api/boards/${boardId}`);
          await reload().catch(() => {});
          toast("Board added", "success");
          navigate(`/w/${board.workspaceId}/b/${boardId}`, { replace: true });
        } else {
          const { workspaceId } = await acceptInvite(token);
          await reload().catch(() => {});
          toast("Joined workspace", "success");
          navigate(`/w/${workspaceId}`, { replace: true });
        }
      } catch {
        toast(kind === "share" ? "Share link is invalid or expired" : "Invite is invalid or expired", "error");
        navigate("/", { replace: true });
      }
    })();
  }, [token, kind]);

  return <div className="grid h-screen place-items-center text-slate-400">Opening…</div>;
}
