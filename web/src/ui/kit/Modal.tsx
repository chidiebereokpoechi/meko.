import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import type { ReactNode } from "react";

// Lifted from spenny's CenterModal: dim backdrop + centered white rounded-xl panel, focus-trapped,
// Esc / backdrop-click to close (headless handles a11y). Replaces native confirm/prompt.
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-[#030412]/30" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="flex w-full max-w-sm flex-col gap-4 rounded-xl bg-white px-8 py-9 shadow-lg">
          {title && <DialogTitle className="heading text-base text-slate-700">{title}</DialogTitle>}
          {children}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
