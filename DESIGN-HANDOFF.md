# DESIGN-HANDOFF.md — Programmable Revenue Agreement (web/)

Handoff for designers/developers picking up the UI. Status: audited with Playwright +
axe-core (0 violations), contrast gate green, token-layer Blocker fixed, approved
discovery redesign implemented. Nothing below changes protocol, routes, or data shapes.

## 1. Tokens (single source: `web/src/styles/tokens.css` + `base.css`)

- **Rule that bit us:** in Tailwind v4, `--color-{name}` generates `bg-{name}` /
  `text-{name}` / `border-{name}`. Doubled names (`--color-bg-surface`) generate
  *nothing* — utilities must be used with the exact key suffix.
- Brand ramps (frozen): purple `#6d45fe` family, ink neutrals, coral/amber/mint/red.
  Display: Hanken Grotesk Variable. Mono (numbers/labels): Geist Mono Variable.
- Semantic aliases (resolve per `.theme-light` / `.theme-dark` root):
  `surface`, `surface-inset`, `subtle`, `strong`, `primary`, `secondary`, `accent`,
  `healthy`, `warning`, `danger`, `holders-share`, `creator-share`.
- Text-role values are darkened on light theme for contrast
  (`--healthy: #0c7c5e`, `--danger: #d61f36`); dark theme keeps bright ramps.
- Spacing = Tailwind 4px grid only. Radii in use: 8 / 24 / pill / 6px. One shadow
  (active-step purple glow). Page roots use `min-h-dvh`; content `max-w-[1200px]`
  (workspace `max-w-[1600px]` — accepted, 3-column data layout).

## 2. Component specs

| Component | File | Variants / states | Spacing / responsive |
|---|---|---|---|
| `Button` | `components/ui/button.tsx` | primary (h-12/48px), secondary (h-11/44px), danger, ghost; `loading` swaps label for dots, disables + guards double-submit | Full-width in panels; 8–12px group gaps |
| `TextInput`/`NumberInput` | `components/ui/input.tsx` | h-14, 16px input (no iOS zoom), label-above, inline error + fix hint, `placeholder:text-secondary` (7.3:1) | Label 4–8px above field; fields 16–24px apart |
| `AgreementSelector` | `features/workspace/AgreementSelector.tsx` | Cards: local name (or `Agreement #id`), `StatusPill`, role badge (CREATOR/DEPOSITOR/ADMIN/VIEWER, wallet-relative), selected ring; search filters live, submit opens a pasted address; loading/error/empty/no-match states; "+ New agreement" → step 01; clear-selection | `max-h-64` scroll; 8px card gaps; hidden in mock mode |
| `DealBoard` | `features/workspace/DealBoard.tsx` | Empty state (CTA hidden when already on step 01) → identity KPIs → dark waterfall → supply grid → positions → tier table | `space-y-5` sections; dark panels are hardcoded dark, not OS-driven |
| Step panels | `features/workspace/steps/*.tsx` | One primary action each; wallet-gated via `RequireWallet` when disconnected; instruction name kept as mono subtitle (protocol transparency) | Panel shell `p-5/6`, 16px field rhythm |
| `TxDrawer` | `components/ui/tx-drawer.tsx` | `max-w-lg` (512px), Build→Finalized segments, checklist, signature, compute units, collapsible logs | Right-side, auto-closes on confirm |
| `NetworkBanner` | `components/ui/network-banner.tsx` | Live slot / RPC-unreachable / program id / missing-mint warning; `role="status"` | Header (xl+) + landing footer |
| `WalletButton` | `components/ui/wallet-button.tsx` | 44px connect/disconnect, wallet-name chip, truncated address, `aria-label`s | Compact (headers) / full (gates) |

## 3. Interaction notes

- Wallet sign-in is the only auth (Phantom + Solflare, `autoConnect`, friendly
  `onError` toasts for cancel/unsupported/failure). Every panel is gated when
  disconnected; `DevnetClient` throws `WalletNotConnected` as a backstop.
- Motion 150–300ms expo-out, transform/opacity only, `prefers-reduced-motion`
  respected (`base.css` + `MotionConfig reducedMotion="user"`).
- Feedback: toasts (8s — hold tx signatures deliberately), tx drawer stages,
  activity log (`role="log"`), inline field errors with fix hints.
- Keyboard: verified 12-stop walk (logo → help → connect → steps → actions),
  all with visible 2px focus rings; `?`/arrows/`D` shortcuts in mock mode.

## 4. Accessibility notes

- axe-core (wcag2a + wcag2aa): **0 violations** on `/`, `/app`, `/a/demo`,
  `/a/demo/run` (create + wind-down steps).
- `npm run contrast` (19 pairs, both themes): all strict pairs pass; text ≥4.5:1,
  focus ring 4.1:1 (needs 3:1). One accepted deviation: resting input borders
  (~1.4:1) — 3:1 signal carried by focus/error states + labels (`AGENTS.md` §4).
- Icon-only buttons have `aria-label`s; toasts `role="status"`; dynamic log is
  `role="log"` `aria-live`. Body-small 14px, captions 12px min, inputs 16px,
  `tnum` figures, persistent underlines on body links.
- Lighthouse could not run here (headless `NO_FCP` environment limit) — re-run
  in CI with a real Chrome before release.

## 5. Remaining issues — decisions taken (all changes implemented)

1. **Resting-border strictness** → KEEP subtle (accepted deviation, `AGENTS.md` §4).
   A 3:1 purple-on-white border needs ~75% opacity and would destroy the airy
   look; focus (5.3:1) + error (5.1:1) + labels carry the signal.
2. **Logo mark** → Lockup mark bumped 24px → 28px for legibility; geometry untouched.
3. **Loading skeletons** → IMPLEMENTED in `AgreementSelector` (pulsing card
   skeletons, `motion-safe`, announced via `aria-label`); DealBoard keeps its
   empty state (reads are fast/background).
4. **Dense chips** → step/persona nav now 44px (rail `py-3`, mobile strips `h-11`);
   small preset/utility chips stay 32px (documented in `AGENTS.md` §4).
5. **Dark-mode strategy** → KEEP light-pinned (full dark theme = separate project).
6. **StartScreen** → KEPT (retiring = route change, out of scope); footer reworded
   to devnet-accurate microcopy.
