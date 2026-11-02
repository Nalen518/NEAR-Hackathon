// Counts shown next to deliveries. Computed in code (DESIGN-HANDOFF §5.3).

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export { weightedLength } from "@shark/shared";

/** "j_000042" → "#0042". */
export const jobNo = (orderId: string) => `#${orderId.replace(/^j_0*/, "").padStart(4, "0")}`;
