# meko. — frontend design system

Living doc. Keep the UI coherent by following these. Update it when a rule changes.

## Identity

- The product name is **"meko."** — lowercase, trailing period. Always.

## Visual tokens (lifted from spenny.io-web)

- **Primary** `#6e24ff`, **primary-dark** `#3600a3`. Text `slate-700`; muted `slate-400/500`.
- Base font **Manrope**, body `text-xs` (16px root), `tabular-nums`.
- Radii: controls `rounded-lg`, cards/tiles `rounded-xl`/`rounded-2xl`, modals `rounded-xl`.
- Shadows: `shadow-lg` on cards/modals/floating UI.
- Focus: `focus:ring-4 ring-primary/20` on every interactive element (global `*` rule).
- Borders: 2px (`border-2`), `border-slate-100/200`; inputs sit on `bg-slate-50`.

## Layout (lifted from Milanote)

Three zones:

1. **Top bar** (full width, `bg-slate-100`): left = `meko.` logo mark + breadcrumb /
   workspace switcher. Right = action icons (search, help, notifications, settings) + account.
2. **Tool rail** (board editor only, vertical, white, `border-r`): stacked tools as
   icon-in-rounded-square + small label beneath. The active tool's icon square is filled
   primary. Destructive/secondary (Trash) pinned to the bottom.
3. **Canvas / home**: light `bg-slate-100` surface. The boards home renders each board as a
   **colored rounded tile** (palette derived from board id) + bold title + meta line; a small
   eye badge marks view-only boards. The board editor renders free-positioned element cards.

## Interaction rules (non-negotiable)

- **No native browser dialogs.** Never `window.alert` / `confirm` / `prompt`. Use `<Modal>`
  for input/confirmation and `toast()` for transient feedback (`kit/`).
- **Forms submit on Enter.** Every form is a real `<form onSubmit>`; the primary action is a
  `type="submit"` button. Inputs live inside the form so Enter submits.
- **Components come from `src/ui/kit/`** — `Button`, `TextField`, `Modal`, `toast`, `icons`.
  Don't hand-roll one-off buttons/inputs; extend the kit so the look stays uniform.
- Async actions show a loading state (`Button loading`) and surface failures via `toast`.
- **Select then edit.** First click selects an element (shows its contextual rail); a second
  click enters edit mode (text caret). Clicking empty canvas deselects.
- **One rail, contextual.** A selected note swaps the create-rail for its formatting rail
  (`NoteSubRail`) — the same rail stays while the caret is active; never a second toolbar.
- **Rich text is sanitised HTML.** Notes are `contentEditable`; formatting is `execCommand` on
  the selection. The HTML comes from peers, so `sanitizeHtml` (allowlist tags + a few style
  props) runs before persisting to Yjs AND before rendering. Never inject unsanitised innerHTML.
  (Per-note last-write-wins; true char-merged rich text would need a Y.Xml binding — deferred.)

## Kit reference

- `Button` — `variant`: `primary` (default) | `ghost` | `tool`; `loading` shows a spinner.
- `TextField` — label always above (slate-400), 2px border on slate-50, primary focus ring,
  red error state + message. (Matches spenny's filter/field rows.)
- `Badge` — small rounded pill (status / role / view-only), color by tone.
- `Modal` — headless `Dialog`: backdrop + centered panel, Esc/backdrop close, focus-trapped.
- `toast(message, type?)` — transient bottom-right notice; `<Toaster/>` mounts once in `App`.
