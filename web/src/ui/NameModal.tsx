import { useEffect, useState } from "react";
import { Button, Modal, TextField } from "./kit/index.ts";

// Single-field create dialog (replaces window.prompt). The <form> means Enter submits.
export function NameModal({
  open,
  title,
  label,
  submitLabel = "Create",
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  label: string;
  submitLabel?: string;
  onSubmit: (value: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setValue("");
      setBusy(false);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    setBusy(true);
    try {
      await onSubmit(v);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <TextField name="name" label={label} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
