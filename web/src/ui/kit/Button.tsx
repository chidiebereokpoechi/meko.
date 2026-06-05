import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost";

// Lifted from spenny's PrimaryButton: rounded-lg, primary fill, spinner while loading.
export function Button({
  variant = "primary",
  loading = false,
  className = "",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  const base = "rounded-lg py-2 px-3 gap-2 inline-flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "bg-primary text-white hover:bg-primary-dark focus:bg-primary-dark disabled:bg-[#e7e7eb]"
      : "text-slate-500 hover:text-primary-dark disabled:text-slate-300";
  return (
    <button className={`${base} ${styles} ${className}`} disabled={disabled || loading} {...props}>
      {loading ? <Spinner /> : children}
    </button>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-white/40" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="white" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
