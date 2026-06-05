// Minimal inline stroke icons (heroicons-style), 24px, currentColor. Keeps the bundle dep-free.
type P = { className?: string };
const svg = (path: React.ReactNode) =>
  function Icon({ className }: P) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em">
        {path}
      </svg>
    );
  };

export const NoteIcon = svg(<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h5" /></>);
export const ImageIcon = svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m4 18 5-5 4 4 3-3 4 4" /></>);
export const LinkIcon = svg(<><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></>);
export const ExportIcon = svg(<><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>);
export const TrashIcon = svg(<><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13" /></>);
export const SearchIcon = svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></>);
export const HelpIcon = svg(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01" /></>);
export const BellIcon = svg(<><path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5 2 6H4c.5-1 2-2 2-6" /><path d="M10 20a2 2 0 0 0 4 0" /></>);
export const SettingsIcon = svg(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2" /></>);
export const PlusIcon = svg(<path d="M12 5v14M5 12h14" />);
export const EyeIcon = svg(<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>);
export const ChevronDown = svg(<path d="m6 9 6 6 6-6" />);
export const UndoIcon = svg(<><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>);
export const RedoIcon = svg(<><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></>);
export const ShareIcon = svg(<><path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></>);
export const ArrowLeftIcon = svg(<path d="M19 12H5m0 0 6-6m-6 6 6 6" />);
export const AlignIcon = svg(<path d="M4 6h16M4 12h10M4 18h16" />);
export const PaintIcon = svg(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></>);
export const BulletListIcon = svg(<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" fill="currentColor" /><circle cx="4.5" cy="12" r="1" fill="currentColor" /><circle cx="4.5" cy="18" r="1" fill="currentColor" /></>);
export const NumberListIcon = svg(<path d="M10 6h10M10 12h10M10 18h10M4 5v3M3 12h2l-2 3h2" />);
export const LinkToolIcon = LinkIcon;

