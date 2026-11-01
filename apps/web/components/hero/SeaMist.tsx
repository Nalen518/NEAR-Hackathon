"use client";
// Sea mist (D-171, Figma 162:2913): our own drifting halftone fog. Dots on an 8 px grid, radius from smooth
// value noise. Drawn ONCE (when it first nears the viewport, and on resize) into a canvas 160 px wider than
// its box; a CSS transform drifts it about 8 px/s on the compositor, so it costs no main thread per frame.
// Static under reduced motion (the CSS animation only runs under prefers-reduced-motion: no-preference).
import { useEffect, useRef } from "react";
import { cx } from "../ui/primitives";

const TONE = {
  light: { rgb: "110,139,168", alpha: 0.55 }, // shark blue grey on the light page
  dark: { rgb: "252,252,253", alpha: 0.32 }, // white on ink
} as const;
const DRIFT = 160; // px of travel = 20 s at 8 px/s

// Small hash based value noise, enough for soft fog. Display only.
function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fog = (x: number, y: number) => 0.65 * noise(x, y) + 0.35 * noise(x * 2.1 + 7, y * 2.1 + 3);

export function SeaMist({ tone, className }: { tone: keyof typeof TONE; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = box.current;
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!el || !canvas || !ctx) return;
    const { rgb, alpha } = TONE[tone];
    let drawnFor = "";
    const draw = () => {
      const w = el.clientWidth + DRIFT;
      const h = el.clientHeight;
      if (!w || !h || drawnFor === `${w}x${h}`) return;
      drawnFor = `${w}x${h}`;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = `rgba(${rgb},${alpha})`;
      ctx.beginPath();
      const G = 8;
      for (let y = G / 2; y < h; y += G)
        for (let x = G / 2; x < w; x += G) {
          const r = Math.max(0, (fog(x / 180, y / 140) - 0.42) * 3.2); // only the dense parts show
          if (r < 0.15) continue;
          const rr = Math.min(r, 1.8);
          ctx.moveTo(x + rr, y);
          ctx.arc(x, y, rr, 0, Math.PI * 2);
        }
      ctx.fill(); // one fill for every dot
    };
    // Draw only when it first comes near the viewport (the stage and the CTA are far down the page).
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        draw();
        io.disconnect();
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    let t: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => drawnFor && draw(), 150);
    });
    ro.observe(el);
    return () => {
      io.disconnect();
      ro.disconnect();
      clearTimeout(t);
    };
  }, [tone]);

  return (
    <div ref={box} aria-hidden className={cx("overflow-hidden", className)}>
      <canvas ref={ref} className="anim-mist block" />
    </div>
  );
}
