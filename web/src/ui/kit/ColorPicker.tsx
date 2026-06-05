import { useState } from "react";
import { CirclePicker } from "react-color";
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

// Color picker mirroring spenny's ColorInput: a CirclePicker of presets with a toggle to
// react-colorful's HexColorPicker, seeded with the current value. Emits uppercase hex.
export function ColorPicker({ value, onChange }: { value?: string; onChange: (hex: string) => void }) {
  const [custom, setCustom] = useState(false);
  return (
    <div className="flex w-full flex-col items-center gap-4">
      {custom ? (
        <HexColorPicker color={value ?? "#6E24FF"} onChange={(v) => onChange(v.toUpperCase())} style={{ width: "100%" }} />
      ) : (
        <CirclePicker
          className="!w-full"
          colors={PALETTE}
          color={value}
          circleSize={26}
          circleSpacing={10}
          styles={{ default: { card: { boxShadow: "none", width: "100%" } } }}
          onChangeComplete={(c) => onChange(c.hex.toUpperCase())}
        />
      )}
      <button onClick={() => setCustom((x) => !x)} className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary-dark">
        {custom ? "Choose from presets" : "Use custom color"}
      </button>
    </div>
  );
}
