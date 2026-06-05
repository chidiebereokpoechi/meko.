import { useEffect, useState } from "react";

// Tiny toast store — transient feedback that replaces window.alert. toast() from anywhere;
// <Toaster/> mounts once in App.
type Tone = "info" | "error" | "success";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

let seq = 0;
let toasts: Toast[] = [];
const listeners = new Set<(t: Toast[]) => void>();
const emit = () => listeners.forEach((l) => l(toasts));

export function toast(message: string, tone: Tone = "info") {
  const t: Toast = { id: ++seq, message, tone };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    emit();
  }, 4000);
}

const toneClass: Record<Tone, string> = {
  info: "bg-slate-700 text-white",
  error: "bg-red-500 text-white",
  success: "bg-green-600 text-white",
};

export function Toaster() {
  const [items, setItems] = useState<Toast[]>(toasts);
  useEffect(() => {
    listeners.add(setItems);
    return () => void listeners.delete(setItems);
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} className={`pointer-events-auto rounded-lg px-4 py-2 text-xs font-bold shadow-lg ${toneClass[t.tone]}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
