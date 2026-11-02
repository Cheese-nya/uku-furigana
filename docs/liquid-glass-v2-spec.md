# Liquid Glass v2 — UI spec for panel ports

Approved by the user on 2026-10-22. The interactive reference is
`docs/mockups/liquid-glass-v2.html` (open it and read its CSS/markup; it is the
source of truth for look and motion). Foundation code is already in the app:

| File | What it gives you |
|---|---|
| `app/globals.css` | Tokens (`--bg --surface --surface-2 --fill --fill-2 --sep --label --label-2 --label-3 --ink --on-ink --ruby --review --ok --danger`), `.glass`, `.gbtn`, `.btn`, `.sel/.seg`, `.scroll-edge`, springs `--spring-bouncy/--spring-smooth` |
| `app/components/glass/GlassButton.tsx` | `<GlassButton variant="item|glass|prominent" icon>` (press physics built in), `<GlassCapsule>` (a glass group of items) |
| `app/components/glass/LiquidSelector.tsx` | `<LiquidSelector options value onChange variant="glass|solid|bare" axis>` — segmented control with the stretch/spring/drag-lens indicator |
| `app/components/glass/GlassPopover.tsx` | `<GlassPopover open onClose anchor|point placement tier="panel|sheet">`, `<PopoverItem icon detail danger>`, `<PopoverSeparator>` |
| `app/components/glass/hooks.ts` | `useGlass()` (refraction ref for custom glass elements — add class `glass`), `usePressPhysics()` |
| `app/components/glass/icons.tsx` | SF-style icons: `IconEdit IconBooks IconRead IconStack IconGear IconMore IconPlus IconClose IconSearch IconStar IconStarFill IconChevronDown/Left/Right IconShare IconImport IconTextFormat IconDictionary IconCheck IconDoc IconLink IconPaste IconTrash IconWarning IconRuby IconSun IconMoon IconGlobe IconHeart IconPulse IconRefresh IconBookmark IconFolder` |

## Material

Glass is a *material*, not a tint: it blurs and saturates what is behind it, and
it must keep the text on it readable whatever that is. (Same principle as
Apple's Liquid Glass — one material family, a few roles, never a raw alpha
picked per component.)

| Role | Class | Fill (light / dark) | Allowed surfaces | Never |
|---|---|---|---|---|
| chrome | `.glass` | 0.14 / 0.42 — 0.18 / 0.48 | floating chrome over the flat canvas only: desktop sidebar, toolbar capsules over a `.scroll-edge`, the search field | anything that can have text or imagery directly behind it |
| panel | `.glass.glass-solid` | 0.72 / 0.80 | menus, popovers, context menus (`GlassPopover` default), the reader capsule, the phone tab bar (`+ .glass-nav`) | a full-screen modal body |
| sheet | `.glass.glass-sheet` | 0.80 / 0.80 | modals, toasts, the mobile bottom cards, large floating cards (`<GlassPopover tier="sheet">`) | a small menu |
| prominent | `.glass.glass-prominent` | ink | the one primary action on a floating layer | secondary actions |

**One surface carries exactly one role.** Do not append a second tier class to
a component that already sets one — pass the role (`tier`) and let the
component own the material.

Text on a material keeps **two** levels. `--label-2` and `--label-3` are
re-declared inside `.glass-solid` / `.glass-sheet`, because a translucent fill
under translucent ink cannot hold AA over a dark backdrop: at the 0.72 fill
over a navy cover (#232B3F) the primary label is 11.2:1, the secondary ink
(#4B4B50) 5.0:1, and a third, fainter level only reaches 1.8:1 — so tertiary
text collapses into the secondary level and hierarchy comes from size and
weight. Tertiary ink stays for chrome over the canvas, where the backdrop is
known.

## Rules

1. **Glass only on the floating layer**: toolbars (as `GlassCapsule` groups or a
   `LiquidSelector variant="glass"`), popovers/menus, sheets, the reader capsule.
   Pick the role from the table above; a surface that carries text is never the
   chrome tier. At the chrome alpha a menu inherited the backdrop's luminance
   and its `--label` text vanished; the reader capsule and the phone tab bar had
   page text and book covers reading straight through them. Because a solid
   body is white, the tab bar's selection pill flips to `--fill`
   (`glass-nav`); a white pill on a white bar is gone.
   **Content is solid**: cards are `bg-[var(--surface)] rounded-[18px]` with
   `shadow-[var(--card-shadow)]`; never put a card inside a card.
   `prefers-reduced-transparency: reduce` drops every tier to `--surface` and
   removes the blur; any surface built on `.glass` inherits that for free.
2. **One material per surface, no nesting**: a glass element never contains
   another glass element. Inside a glass container use `GlassButton
   variant="item"` (transparent, the capsule is the material) and
   `LiquidSelector variant="bare"`; `variant="glass"` is only for a capsule that
   is its own top-level surface. Two capsules side by side stay separate — the
   design does not merge them.
3. **Glass is for interactive and floating things.** Do not put the material on
   static content that could be a card. Interaction feedback is opt-in: the
   press physics live in `GlassButton` / `.btn` / the selector indicator, not on
   decorative glass.
4. **Colour**: neutral ink. Text `text-[var(--label)]`, secondary
   `text-[var(--label-2)]`, tertiary `text-[var(--label-3)]`. Primary action =
   ink (`btn btn-ink` in content, `GlassButton variant="prominent"` in toolbars).
   Colour only for state: review `var(--review)` (orange), confirmed `var(--ok)`
   (green), error `var(--danger)` (red). Remove indigo/blue/violet/emerald/amber
   decoration classes and hard-coded hex colours (`#1d1d1f`, `#6e6e73`, `zinc-*`,
   `slate-*` text) in favour of the tokens. Dark mode then works through the
   tokens — do not add `dark:` colour variants for things the tokens cover.
5. **Buttons**: toolbar controls are `GlassButton`; content buttons use `btn`
   (`btn btn-ink`, `btn btn-danger`, `btn btn-plain`). Segmented choices use
   `LiquidSelector` (`variant="glass"` in a toolbar, `"solid"` in content/popovers).
6. **Toolbars float**: `sticky top-[max(10px,env(safe-area-inset-top))] z-20`
   row of glass capsules with `pointer-events-none` on the row and
   `pointer-events-auto` on capsules, so content scrolls underneath. Add a
   `.scroll-edge` strip behind it (fixed height ~70px) if content scrolls under.
7. **Icons**: only from `glass/icons.tsx`; no emoji, no `★ ☆ ☼ ☾`, no inline
   one-off SVG icon components (delete them).
8. **Typography**: UI sans system font; Japanese titles on covers / reader text
   may use `font-family: var(--font-mincho)`. Ruby `rt` colour `var(--ruby)`.
9. **Motion**: press physics come from GlassButton / `.btn`; popovers morph from
   their anchor (GlassPopover does it). Respect `prefers-reduced-motion` (the
   primitives already do).
10. **Keep behaviour**: every prop, handler, state, i18n string and
   `data-testid` that drives behaviour must keep working. Remove only visual
   cruft. Do not touch files you do not own.
11. **States**: loading (skeleton/spinner + label), empty (icon, one-line
   explanation, next action), error (message + retry) must exist where the
   panel has them today.

## Workers must not

- edit `app/globals.css`, `app/page.tsx`, anything in `app/components/glass/`,
  or `tests/` (the leader updates design-lock tests after review);
- run `npm`, `node`, `npx` or a dev server (the leader builds and tests);
- add dependencies.
