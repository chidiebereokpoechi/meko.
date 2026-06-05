import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import * as Icon from "./icons.tsx";

export interface Option<T extends string> {
  value: T;
  label: string;
}

// Ported from spenny's SelectInput (headless Listbox): 2px border on slate-50, primary focus ring,
// rounded options panel with divide-y, primary-fill selected row + check. No react-popper here —
// the panel anchors directly under the button (fine inside modals/rails).
export function Select<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
  className = "",
}: {
  label?: string;
  name?: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <div className={`grid gap-1.5 ${className}`}>
      {label && (
        <label htmlFor={name} className="text-xs text-slate-400">
          {label}
        </label>
      )}
      <Listbox value={value} onChange={onChange} as="div" className="relative">
        <ListboxButton className="flex w-full items-center justify-between gap-2 rounded-lg border-2 border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 outline-none hover:border-primary/20 focus:border-primary focus:ring-4 focus:ring-primary/20">
          <span>{current?.label}</span>
          <Icon.ChevronDown className="shrink-0 text-base text-slate-400" />
        </ListboxButton>
        <ListboxOptions className="absolute left-0 z-[95] mt-1 grid w-full grid-cols-1 divide-y-2 divide-slate-100 overflow-hidden rounded-lg border-2 border-slate-200 bg-slate-50 text-xs shadow-lg outline-none">
          {options.map((o) => (
            <ListboxOption
              key={o.value}
              value={o.value}
              className="flex w-full cursor-pointer items-center px-3 py-2 font-bold text-slate-600 data-[focus]:bg-slate-100 data-[selected]:bg-primary data-[selected]:text-white data-[focus]:data-[selected]:bg-primary-dark"
            >
              {({ selected }) => (
                <>
                  {selected && <Icon.CheckIcon className="mr-2 text-sm" />}
                  <span>{o.label}</span>
                </>
              )}
            </ListboxOption>
          ))}
        </ListboxOptions>
      </Listbox>
    </div>
  );
}
