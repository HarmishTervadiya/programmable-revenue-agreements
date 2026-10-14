# AGENTS.md — Programmable Revenue Agreement

Instructions for AI coding agents working in this repo. Follow these on every task.

## 0. Standing rules (never violate)

1. **Do NOT touch the protocol.** `programs/`, `Anchor.toml` program IDs/seeds, instruction
   account layouts, and `protocol.md` semantics are frozen. The web app must stay 100%
   compatible with the on-chain program. Never invent program IDs, instructions, or accounts.
2. **Do NOT commit, push, amend, or open PRs** unless the user explicitly asks. Leave all work
   as uncommitted working-tree changes.
3. **Preserve the brand.** Purple theme (`#6d45fe` family), Hanken Grotesk display + Geist Mono
   mono, existing design language. Polish spacing/alignment/contrast — never reskin or re-template.
4. **Wallet sign-in is the only auth.** No email/password, no backend sessions, no user database.
   All Solana work targets **devnet** (`2iEFwZ8qPjvEfSAtHqE7G7apQo9tVKFsiLrdAFC5sXop`).
5. **No new dependencies without asking.** Exception: already-approved dev tooling.
6. UI fixes must not change business logic, routing, data flow, or copy meaning.

## 1. Stack & token source

- Web app lives in `web/` (React 18 + Vite 6 + Tailwind CSS v4 + Solana wallet-adapter + Anchor).
- **Single token source:** `web/src/styles/tokens.css` (`@theme` brand ramps) +
  `web/src/styles/base.css` (`.theme-light` / `.theme-dark` semantic aliases like
  `--text-primary`, `--accent`, `--healthy`, `--danger`).
- **Always use semantic aliases** (`text-secondary`, `bg-surface`, `border-danger`, …), never new
  hardcoded hex. Brand ramps stay intact; adjust *text-role* values per theme when contrast
  requires it (precedent: light `--healthy: #0c7c5e`, `--danger: #d61f36`).
- Spacing follows Tailwind's 4px grid. Use scale values only (`p-4/6/8`, `gap-2/4`), `gap`
  instead of per-child margins, `min-h-dvh` for page roots, `max-w-[1200px]` content containers.

## 2. UI/UX rules (distilled from the project's UI-UX-RULES skill)

- **Type:** 2 families max (display + mono-for-numbers only). Body-small ≥ 14px, captions/meta
  ≥ 12px — never below 12px anywhere. Inputs ≥ 16px (prevents iOS zoom). Tabular numbers
  (`tnum`) for figures. Links need a non-color cue (underline).
- **Contrast (WCAG 2.2 AA):** text ≥ 4.5:1, large text/UI parts/focus rings ≥ 3:1, focus ring
  ≥ 2px (see `:focus-visible` in `base.css`). Never color-alone for status — pair with icon/text.
- **Touch:** primary actions 44–48px high; any target ≥ 24px absolute minimum with ≥ 8px gaps.
  Icon-only buttons need `aria-label`. Dynamic changes announced (`role="status"`/`role="log"`).
- **Components:** one primary button per view; labels above inputs with inline error + fix hint;
  empty/loading/error states for every data-driven screen; modal widths 480–560px;
  motion 150–300ms with `prefers-reduced-motion` respected.
- **Dark mode:** verify every pair separately; use lighter surfaces (not heavier shadows).

## 3. Working procedure for UI tasks

1. Discover affected components; reuse existing components/tokens/patterns.
2. Audit against §2; log violations as `file:line | rule | current | fixed`.
3. Fix in small batches (tokens → typography → color → components → a11y).
4. Verify: `npm run contrast` (must pass), `npm run typecheck`, `npm run test`,
   `npm run build`. Check 360px and 1440px widths.
5. Report: changed table, contrast results, items left alone + why, open questions.

## 4. Accepted deviations (do not "fix" without a design decision)

- Resting input/secondary-button borders (~1.4:1) are intentionally subtle; the 3:1 signal is
  carried by focus (`accent`, 5.3:1) and error (`danger`, 5.1:1) states plus labels.
- `max-w-[1600px]` workspace (3-column data layout, not a reading page).
- Dense 32px preset/utility chips (buy presets, deposit amounts — exceed 24px WCAG
  minimum, 8px gaps); step/persona nav and all primary actions are 44px+.
- `rounded-[14px]` inputs (within the 12–16 prominent-surface radius band).
- Light theme pinned on marketing/workspace screens; dark surfaces exist only inside
  data panels (DealBoard waterfall/supply). No full dark theme — separate project.

## 5. Key references

- Protocol semantics: `protocol.md` (read before any chain-related UI work).
- Program IDs / seeds: `Anchor.toml`, `programs/.../src/{lib,state,instructions}.rs`.
- Devnet wiring: `web/src/protocol/devnetClient.ts`, `web/src/lib/program/pdas.ts`.
- Env template: `web/.env.example` (local `web/.env` is gitignored).
