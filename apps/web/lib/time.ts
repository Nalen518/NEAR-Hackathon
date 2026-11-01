"use client";
import { useEffect, useState } from "react";

/** Current time, ticking every second while `active` (countdowns, 24 h unlocks). */
export function useNow(active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}
