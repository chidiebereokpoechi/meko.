# meko. — frontend design system

Living doc. Keep the UI coherent by following these. Update it when a rule changes.

## Identity

- The product name is **"meko."** — lowercase, trailing period. Always.

## Source of truth: spenny.io-web

This UI lifts its design + components from `../spenny.io-web`. **Before building any UI element,
check spenny first** and reuse its library/approach — don't reinvent. Established choices:
`@headlessui/react` (dialogs, menus, popovers), `react-colorful` `HexColorPicker` (custom color),
`react-popper` if popper-style positioning is needed. Match spenny's class conventions.

## Visual tokens (lifted from spenny.io-web)

- **Primary** `#6e24ff`, **primary-dark** `#3600a3`. **Accent** `#aeef34` (lime, from the logo
  wordmark — `bg-accent`/`text-accent`; pairs on the primary purple, not legible as text on white).
  Text `slate-700`; muted `slate-400/500`.
- **Logo mark**: `web/public/meko.png`, served at `/meko.png` (favicon, top-bar mark, login).
- Base font **Manrope**, body `text-xs` (16px root), `tabular-nums`.
- Radii: controls `rounded-lg`, cards/tiles `rounded-xl`/`rounded-2xl`, modals `rounded-xl`.
- Shadows: `shadow-lg` on cards/modals/floating UI.
- **Borders + dividers are ALWAYS 2px.** Use `border-2` / `border-t-2` / `border-b-2` etc — never
  the 1px `border` / `border-t`. This includes hairline dividers inside menus and popovers.
  Colour: `border-slate-100` (dividers/subtle) or `border-slate-200`. Inputs sit on `bg-slate-50`.

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

## Element conventions

- **Every element type has its own contextual sub-rail** (note, link, image, …). When adding a new
  element type, build its `*SubRail` reusing the shared rail primitives exported from `NoteSubRail`
  (`RailBtn`, `Popover`, `ColorTabs`, `StripPicker`).
- **Every element's sub-rail includes at least a Top-strip colour tool; named color not TopStrip** (`StripPicker` in a
  `Popover`), wired to `style.strip`. Other colour/format tools are per-type.

## Kit reference

- `Button` — `variant`: `primary` (default) | `ghost` | `tool`; `loading` shows a spinner.
- `TextField` — label always above (slate-400), 2px border on slate-50, primary focus ring,
  red error state + message. (Matches spenny's filter/field rows.)
- `Badge` — small rounded pill (status / role / view-only), color by tone.
- `Modal` — headless `Dialog`: backdrop + centered panel, Esc/backdrop close, focus-trapped.
- `toast(message, type?)` — transient bottom-right notice; `<Toaster/>` mounts once in `App`.
