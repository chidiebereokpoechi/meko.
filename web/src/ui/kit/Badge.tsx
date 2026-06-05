type Tone = "slate" | "primary" | "green" | "amber";

const tones: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-500",
  primary: "bg-primary/10 text-primary-dark",
  green: "bg-green-100 text-green-600",
  amber: "bg-amber-100 text-amber-700",
};

// Small rounded pill — status, role, view-only markers (spenny chip styling).
export function Badge({ tone = "slate", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold ${tones[tone]}`}>{children}</span>;
}
