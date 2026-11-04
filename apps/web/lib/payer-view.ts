import type { Order, OrderPayer } from "@shark/shared";

/** Statuses where the payer view carries a delivery (API A9: never for unresolved or refunds). */
export const DELIVERED = new Set<Order["status"]>(["delivered", "complaint_review", "finalized"]);

/**
 * Shark accepts each NEP-413 signature once, so the payer view is fetched once per signature. This keeps its private
 * parts (brief, instructions, input, delivery) and takes everything that moves on from the latest public view. The
 * delivery hides again if the job leaves the delivered states, for example after an upheld complaint.
 */
export function mergePayerView(payer: OrderPayer, pub: Order | undefined): OrderPayer {
  const status = pub?.status ?? payer.status;
  return {
    ...payer,
    ...pub,
    view: "payer",
    brief: payer.brief,
    input: payer.input,
    instructions: payer.instructions,
    delivery: DELIVERED.has(status) ? payer.delivery : null,
  } as OrderPayer;
}
