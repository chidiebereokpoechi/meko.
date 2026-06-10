import { Modal } from "./kit/index.ts";

const SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Canvas",
    rows: [
      ["Space + drag / middle-drag", "Pan"],
      ["⌘ + scroll / pinch", "Zoom at cursor"],
      ["Drag empty canvas", "Marquee select"],
      ["⇧ / ⌘ + marquee", "Add to selection"],
      ["Esc", "Deselect / cancel drag"],
    ],
  },
  {
    title: "Elements",
    rows: [
      ["Click, then click again", "Select, then edit"],
      ["⌘ + click", "Toggle in multi-selection"],
      ["Double-click", "Open link / board"],
      ["⌥ + click", "Open link / board"],
      ["⌫ / Delete", "Delete selection"],
      ["⌘D", "Duplicate"],
      ["⌘C / ⌘X / ⌘V", "Copy / cut / paste"],
      ["Right-click", "Element menu"],
    ],
  },
  {
    title: "History & app",
    rows: [
      ["⌘Z", "Undo"],
      ["⇧⌘Z / ⌘Y", "Redo"],
      ["⌘K", "Search boards"],
    ],
  },
];

// Static keyboard-shortcut reference behind the top-bar Help button.
export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
        {SECTIONS.map((s) => (
          <div key={s.title}>
            <p className="mb-1 text-xs font-bold text-slate-400">{s.title}</p>
            <div className="flex flex-col">
              {s.rows.map(([keys, what]) => (
                <div key={keys} className="flex items-center justify-between gap-4 py-1">
                  <span className="text-xs text-slate-500">{what}</span>
                  <kbd className="shrink-0 rounded-md border-2 border-line-subtle bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
