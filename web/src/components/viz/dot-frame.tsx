import { useEffect, useRef } from "react";

/**
 * Dot-matrix frame: scattered dots along the viewport edges, dense at
 * corners, thinning inward. Seeded random, drawn once on canvas.
 * Splash / intro / closer only — never dense data screens.
 */
export function DotFrame({
  tone = "dark",
  className,
}: {
  tone?: "dark" | "light" | "purple";
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    // Seeded PRNG so the frame is stable across renders.
    let seed = 1337;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const color =
      tone === "light"
        ? "rgba(109, 69, 254, 0.25)"
        : tone === "purple"
          ? "rgba(199, 187, 255, 0.75)"
          : "rgba(133, 95, 255, 0.7)";

    ctx.fillStyle = color;
    const band = Math.min(220, w * 0.22);
    const spacing = 14;

    for (let x = 0; x < w; x += spacing) {
      for (let y = 0; y < h; y += spacing) {
        // Distance from nearest edge (0 = edge, grows inward).
        const d = Math.min(x, w - x, y, h - y);
        if (d > band) continue;
        const edgeDist = d / band; // 0..1
        // Dense at edges: keep probability rises toward the edge.
        const keep = 1 - edgeDist;
        if (rand() > keep * 0.9 + 0.05) continue;
        const size = 3 + rand() * 3;
        const px = x + (rand() - 0.5) * 6;
        const py = y + (rand() - 0.5) * 6;
        ctx.globalAlpha = 0.4 + (1 - edgeDist) * 0.6;
        ctx.fillRect(px, py, size, size);
      }
    }
  }, [tone]);

  return (
    <canvas
      ref={ref}
      className={className}
      aria-hidden
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
}
