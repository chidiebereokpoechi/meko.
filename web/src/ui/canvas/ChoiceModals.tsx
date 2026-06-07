import { useState } from "react";
import type { Unfurl } from "../../lib/links.ts";
import { Button, Icon, Modal } from "../kit/index.ts";

// A dropped/pasted URL with a preview image: become an image or a link card (with a remember option).
export function UrlChoiceModal({ preview, onPick, onClose }: { preview: Unfurl; onPick: (kind: "image" | "link", remember: boolean) => void; onClose: () => void }) {
  const [remember, setRemember] = useState(false);
  return (
    <Modal open onClose={onClose} title="Add as image or link?">
      {preview.imageUrl && <img src={preview.imageUrl} alt="" className="max-h-40 w-full rounded-lg border-2 border-line-subtle object-cover" />}
      {preview.title && <p className="truncate text-xs font-bold text-slate-600">{preview.title}</p>}
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => onPick("image", remember)}>
          <Icon.ImageIcon className="text-base" /> Image
        </Button>
        <Button variant="ghost" className="flex-1 border-2 border-line" onClick={() => onPick("link", remember)}>
          <Icon.LinkIcon className="text-base" /> Link
        </Button>
      </div>
      <RememberToggle remember={remember} setRemember={setRemember} />
    </Modal>
  );
}

// An embeddable provider URL: a link card (with a live preview) or a bare embed.
export function EmbedChoiceModal({ embed, onPick, onClose }: { embed: string; onPick: (kind: "link" | "embed", remember: boolean) => void; onClose: () => void }) {
  const [remember, setRemember] = useState(false);
  return (
    <Modal open onClose={onClose} title="Link or embed?">
      <iframe src={embed} title="preview" className="h-40 w-full rounded-lg border-2 border-line-subtle" style={{ border: 0 }} sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" />
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => onPick("link", remember)}>
          <Icon.LinkIcon className="text-base" /> Link + preview
        </Button>
        <Button variant="ghost" className="flex-1 border-2 border-line" onClick={() => onPick("embed", remember)}>
          <Icon.EmbedIcon className="text-base" /> Embed
        </Button>
      </div>
      <RememberToggle remember={remember} setRemember={setRemember} />
    </Modal>
  );
}

function RememberToggle({ remember, setRemember }: { remember: boolean; setRemember: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500">
      <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded border-2 border-line-strong accent-primary" />
      Remember my choice
    </label>
  );
}
