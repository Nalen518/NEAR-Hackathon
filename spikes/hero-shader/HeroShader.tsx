"use client";
/**
 * <HeroShader /> — React wrapper for hero-shader.ts (Next.js app router).
 * Usage (landing hero):
 *   <section className="relative overflow-hidden">
 *     <HeroShader className="absolute inset-0" fallbackSrc="/brand/hero-still.png" />
 *     ...hero content (z-10)...
 *   </section>
 */
import { useEffect, useRef, useState } from "react";
import { createHeroShader, type HeroShaderHandle, type HeroShaderOptions } from "./hero-shader";

type Props = HeroShaderOptions & {
  className?: string;
  /** Static image shown when WebGL is unavailable. Export it from the Figma hero. */
  fallbackSrc?: string;
};

export function HeroShader({ className, fallbackSrc, style, cell, lens, tint, fps, maxDpr, reducedMotion, colors }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<HeroShaderHandle | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const h = createHeroShader(canvas, { style, cell, lens, tint, fps, maxDpr, reducedMotion, colors });
    if (!h) setFailed(true);
    handleRef.current = h;
    return () => { h?.destroy(); handleRef.current = null; };
    // Created once; option changes go through setOptions below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handleRef.current?.setOptions({ style, cell, lens, tint, fps, maxDpr, reducedMotion, colors });
  }, [style, cell, lens, tint, fps, maxDpr, reducedMotion, colors]);

  return (
    <div className={className} aria-hidden="true" style={{ pointerEvents: "none" }}>
      {failed && fallbackSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fallbackSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      )}
    </div>
  );
}
