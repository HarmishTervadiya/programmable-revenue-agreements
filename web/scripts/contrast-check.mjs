// Contrast audit per UI-UX-RULES §10 (see AGENTS.md).
// Checks every text/background + functional-border pair used together,
// in both themes. Run: npm run contrast
// Fails on any text < 4.5:1 or UI part < 3:1, except pairs explicitly
// documented below as accepted deviations.
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokensCss = readFileSync(join(root, "src/styles/tokens.css"), "utf8");
const baseCss = readFileSync(join(root, "src/styles/base.css"), "utf8");

// Tailwind default palette entries we rely on.
const extra = {
  "--color-amber-900": "#78350f",
  "--color-white": "#ffffff",
};

function vars(css) {
  const out = {};
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}
function block(css, selector) {
  const m = css.match(new RegExp(selector.replace(".", "\\.") + "\\s*\\{([^}]+)\\}", "s"));
  const out = {};
  if (!m) return out;
  for (const mm of m[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[mm[1]] = mm[2].trim();
  return out;
}
const t = { ...vars(tokensCss), ...extra };
const light = { ...t, ...block(baseCss, ".theme-light") };
const dark = { ...t, ...block(baseCss, ".theme-dark") };
for (const map of [light, dark])
  for (const k of Object.keys(map)) {
    const m = String(map[k]).match(/var\((--[a-z0-9-]+)\)/);
    if (m && map[m[1]]) map[k] = map[m[1]];
  }

function rgb(hex) {
  hex = hex.replace("#", "");
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function blend(fgHex, bgHex, alpha) {
  const f = rgb(fgHex), b = rgb(bgHex);
  const c = f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}
function lum(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// [label, theme, fg, bg, required, kind, strict]
// strict:false = accepted deviation (design decision, see AGENTS.md).
const pairs = [
  ["primary on surface (light)", "light", "--color-text-on-light", "--bg-surface", 4.5, "text", true],
  ["secondary on surface (light)", "light", "--color-text-muted-light", "--bg-surface", 4.5, "text", true],
  ["secondary on purple-50 inset", "light", "--color-text-muted-light", "--color-purple-50", 4.5, "text", true],
  ["secondary on purple-100 page", "light", "--color-text-muted-light", "--color-purple-100", 4.5, "text", true],
  ["accent eyebrow on surface", "light", "--color-purple-500", "--bg-surface", 4.5, "text", true],
  ["white on accent (primary btn)", "light", "--color-white", "--color-purple-500", 4.5, "text", true],
  ["healthy text on surface (light)", "light", "--healthy", "--bg-surface", 4.5, "text", true],
  ["danger text on surface (light)", "light", "--danger", "--bg-surface", 4.5, "text", true],
  ["amber-900 on amber tint", "light", "--color-amber-900", "#FEF6E7", 4.5, "text", true],
  ["ink text on coral chip fill", "light", "--color-text-on-light", "--color-coral-500", 4.5, "text", true],
  ["placeholder (secondary, full)", "light", "--color-text-muted-light", "--bg-surface", 4.5, "text", true],
  ["purple-300 focus ring on surface", "light", "--color-purple-300", "--bg-surface", 3.0, "ui", true],
  ["white on ink-950 (dark body)", "dark", "--color-white", "--color-ink-950", 4.5, "text", true],
  ["muted-dark on ink-950", "dark", "--color-text-muted-dark", "--color-ink-950", 4.5, "text", true],
  ["muted-dark on ink-800 card", "dark", "--color-text-muted-dark", "--color-ink-800", 4.5, "text", true],
  ["purple-300 label on ink-950", "dark", "--color-purple-300", "--color-ink-950", 4.5, "text", true],
  ["healthy on ink-950 (dark)", "dark", "--healthy", "--color-ink-950", 4.5, "text", true],
  ["danger on ink-950 (dark)", "dark", "--danger", "--color-ink-950", 4.5, "text", true],
  ["resting input border purple/15", "light", "#DCD5FB", "--bg-surface", 3.0, "ui", false],
];

let fails = 0;
for (const [label, theme, fg, bg, need, kind, strict] of pairs) {
  const map = theme === "light" ? light : dark;
  const f = map[fg] || fg, b = map[bg] || bg;
  const r = ratio(f, b);
  const ok = r >= need - 1e-9;
  if (!ok && strict) fails++;
  console.log(`${ok ? "PASS" : strict ? "FAIL" : "INFO"} ${r.toFixed(2)}:1 (needs ${need}:1 ${kind}) — ${label} [${f} on ${b}]`);
}
console.log(fails === 0 ? "\nALL STRICT PAIRS PASS" : `\n${fails} FAILING PAIR(S)`);
process.exit(fails === 0 ? 0 : 1);
