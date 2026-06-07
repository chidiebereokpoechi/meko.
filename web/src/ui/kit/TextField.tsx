import type { InputHTMLAttributes } from "react";

// Lifted from spenny's TextInput: floating label (shows once the field has a value), 2px border on
// slate-50, primary focus ring, red error state + messages.
export function TextField({
  label,
  error,
  className = "",
  alwaysShowLabel,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null; alwaysShowLabel?: boolean }) {
  const invalid = !!error;
  // Floating label, spenny-style: hidden until the field has a value (the placeholder carries the
  // label text before then), unless alwaysShowLabel is set.
  const showLabel = alwaysShowLabel || !!props.value;
  return (
    <div className={`grid gap-1.5 ${className}`}>
      {showLabel && (
        <label htmlFor={props.name} className={`text-xs ${invalid ? "text-red-500" : "text-slate-400"}`}>
          {label}
        </label>
      )}
      <input
        aria-label={label}
        className={[
          "rounded-lg border-2 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 outline-none focus:ring-4 placeholder:font-normal placeholder:text-slate-400",
          invalid
            ? "border-red-200 text-red-600 ring-red-600/20 focus:border-red-500 placeholder:text-red-400"
            : "border-line ring-primary/20 hover:border-primary/20 focus:border-primary",
        ].join(" ")}
        placeholder={label}
        {...props}
      />
      {invalid && <div className="text-xs font-bold text-red-500">{error}</div>}
    </div>
  );
}
