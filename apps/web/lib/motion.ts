"use client";
import { useSyncExternalStore } from "react";

const RM = "(prefers-reduced-motion: reduce)";

/** True when the user asks for reduced motion: show end states, pin nothing (prompt §8). */
export function useReducedMotion() {
  return useSyncExternalStore(
    (on) => {
      const m = matchMedia(RM);
      m.addEventListener("change", on);
      return () => m.removeEventListener("change", on);
    },
    () => matchMedia(RM).matches,
    () => false,
  );
}
