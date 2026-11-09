// Counts shown next to deliveries. Computed in code (DESIGN-HANDOFF §5.3).

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export { weightedLength } from "@shark/shared";

/** "j_000042" → "#0042". */
export const jobNo = (orderId: string) => `#${orderId.replace(/^j_0*/, "").padStart(4, "0")}`;

/** Time left as the biggest whole unit: "23 h", "4 min", "40 s" (the demo contract's complaint window is 5 min). */
export function timeLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)} h`;
  if (s >= 60) return `${Math.floor(s / 60)} min`;
  return `${s} s`;
}
