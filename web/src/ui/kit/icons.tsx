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
export const LogoutIcon = svg(<><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5M4 12h11" /></>);
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
export const UsersIcon = svg(<><path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="8" r="4" /><path d="M22 20v-2a4 4 0 0 0-3-3.87M16 4.13a4 4 0 0 1 0 7.75" /></>);
export const CheckIcon = svg(<path d="m5 13 4 4L19 7" />);
export const ChatIcon = svg(<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z" />);
export const CloseIcon = svg(<path d="M6 6l12 12M18 6 6 18" />);
export const SendIcon = svg(<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />);
export const TodoIcon = svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 12 2 2 3-4M14 13h4" /></>);
export const ArrowRightIcon = svg(<path d="M5 12h14m0 0-6-6m6 6-6 6" />);
export const DashIcon = svg(<path d="M4 18 20 6" strokeDasharray="4 3" />);
export const WeightIcon = svg(<path d="M5 7h14M5 12h14M5 17h14" />);
export const LineIcon = svg(<><path d="M5 19 19 5" /><circle cx="5" cy="19" r="2.2" fill="currentColor" /><circle cx="19" cy="5" r="2.2" fill="currentColor" /></>);
export const EmbedIcon = svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none" /></>);
export const ColumnIcon = svg(<><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 11h8M8 15h5" /></>);
export const GripIcon = svg(<><circle cx="9" cy="6" r="1" fill="currentColor" /><circle cx="15" cy="6" r="1" fill="currentColor" /><circle cx="9" cy="12" r="1" fill="currentColor" /><circle cx="15" cy="12" r="1" fill="currentColor" /><circle cx="9" cy="18" r="1" fill="currentColor" /><circle cx="15" cy="18" r="1" fill="currentColor" /></>);
export const BoardIcon = svg(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 9v12" /></>);
export const DotsIcon = svg(<><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" /></>);

