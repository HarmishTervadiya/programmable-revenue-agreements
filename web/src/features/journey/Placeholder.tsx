import { Link } from "react-router-dom";

/** Temporary stand-in while a screen is being built (Phase 4+ replaces these). */
export function PlaceholderStep({
  n,
  name,
  to = "/",
}: {
  n: string;
  name: string;
  to?: string;
}) {
  return (
    <div className="theme-light min-h-screen bg-[var(--bg-page)] flex flex-col items-center justify-center gap-6 p-8">
      <span className="bg-ink-900 text-white mono-label rounded-full px-3 py-1">
        N° {n}
      </span>
      <h1 className="font-display text-4xl">{name}</h1>
      <Link to={to} className="mono-label text-[var(--accent)] underline">
        back to splash
      </Link>
    </div>
  );
}
