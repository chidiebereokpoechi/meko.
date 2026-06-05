import { useState } from "react";
import { HexColorPicker } from "react-colorful";

// Note-appropriate palette — soft paper/pastel fills + neutrals, with a few darks for text,
// keeping the muted tone of spenny's palettes.
export const PALETTE = [
  // neutrals (light → dark; darks double as text colours)
  "#ffffff", "#f1f5f9", "#e2e8f0", "#cbd5e1", "#94a3b8", "#475569", "#1e293b",
  // warm / paper
  "#fef3c7", "#fde68a", "#f5e6c8", "#e4bcad", "#e1a692",
  // rose
  "#fcd9e0", "#df979e", "#d7658b",
  // teal / green
  "#d7e8e4", "#badbdb", "#98d1d1", "#54bebe", "#94c1ba", "#57ae9e",
  // cool / purple
  "#c7d2fe", "#beb9db", "#a86fe2", "#6e24ff",
];

// Color picker mirroring spenny's ColorInput: circle presets with a toggle to react-colorful's
// HexColorPicker (seeded with the current value). Circles are hand-rolled to avoid react-color's
// deprecated-defaultProps warning + bundle weight. Emits uppercase hex.
// Light swatches need a faint outline so they're visible on the light panel.
function isLight(hex: string): boolean {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255 > 0.82;
}

export function ColorPicker({ value, onChange, palette = PALETTE }: { value?: string; onChange: (hex: string) => void; palette?: string[] }) {
  const [custom, setCustom] = useState(false);
  return (
    <div className="flex w-full flex-col items-center gap-4">
      {custom ? (
        <HexColorPicker color={value ?? "#6E24FF"} onChange={(v) => onChange(v.toUpperCase())} style={{ width: "100%" }} />
      ) : (
        <div className="flex flex-wrap justify-center gap-2.5">
          {palette.map((c) => (
            <button
              key={c}
              onClick={() => onChange(c.toUpperCase())}
              className={`h-7 w-7 rounded-full ${value?.toLowerCase() === c.toLowerCase() ? "ring-2 ring-primary ring-offset-2" : isLight(c) ? "ring-2 ring-inset ring-black/10" : ""}`}
              style={{ background: c }}
            />
          ))}
        </div>
      )}
      <button onClick={() => setCustom((x) => !x)} className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary-dark">
        {custom ? "Choose from presets" : "Use custom color"}
      </button>
    </div>
  );
}
