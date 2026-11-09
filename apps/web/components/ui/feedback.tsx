// Feedback components: SystemBanner v2 (135:3286) and the state card used on the Order and Job states boards.
import type { ReactNode } from "react";
import { Chip } from "./primitives";

export type BannerState = "closed" | "paused" | "caged" | "no_worker" | "out_of_budget" | "rate_limited" | "upstream_down";

// Copy from Figma SystemBanner v2, in API check order.
const BANNER: Record<BannerState, { chip: string; title: string; body: string; code: string }> = {
  closed: { chip: "Closed", title: "This company has been wound down.", body: "No new jobs. Every paid job was settled or refunded, and the reserve went back to the owners’ DAO.", code: "503 closed" },
  paused: { chip: "Paused", title: "The company is paused.", body: "The guardian or the owners stopped new jobs. Jobs already paid still finish or get refunded.", code: "503 paused" },
  caged: { chip: "Caged", title: "Shark is in the cage: 3 strikes.", body: "No new jobs until the owners reset the strikes by DAO vote. Open jobs still finish.", code: "503 caged" },
  no_worker: { chip: "No worker", title: "No worker can take this job right now.", body: "Crab and Raven are busy, suspended or at their unresolved limit. Nothing was charged. Try again later.", code: "503 no_worker" },
  out_of_budget: { chip: "Out of budget", title: "Shark has used today’s budget.", body: "Shark funds worker escrow from a daily budget that refills at 00:00 UTC. Nothing was charged.", code: "503 out_of_budget" },
  rate_limited: { chip: "Rate limited", title: "Too many requests: try again in 30 s.", body: "Nothing was charged. Bots: respect the Retry-After header.", code: "429 rate_limited" },
  upstream_down: { chip: "Source down", title: "A service we depend on didn’t answer.", body: "NEAR AI, NEAR RPC or the page fetch was down before quoting. Nothing was charged. Try again shortly.", code: "502 upstream_unavailable" },
};

function retryText(secs: number) {
  return secs >= 120 ? `${Math.round(secs / 60)} min` : `${secs} s`;
}

/** Company can't take jobs; nobody is charged. Ink only. */
export function SystemBanner({ state, retryAfter }: { state: BannerState; retryAfter?: number | null }) {
  const b = BANNER[state];
  const title = state === "rate_limited" && retryAfter ? `Too many requests: try again in ${retryText(retryAfter)}.` : b.title;
  return (
    <div role="status" className="flex items-center gap-4 rounded-md border border-ink bg-surface-2 px-5 py-4">
      <Chip tone="solid">{b.chip}</Chip>
      <div className="flex flex-1 flex-col gap-1">
        <p className="body-default text-ink">{title}</p>
        <p className="body-small text-muted">
          {b.body}
          {state === "out_of_budget" && retryAfter ? ` Retry after ${retryText(retryAfter)}.` : ""}
        </p>
      </div>
      <p className="mono-small whitespace-nowrap text-muted">POST /v1/orders → {b.code}</p>
    </div>
  );
}

/** API §0.3 N1: the host answered for another network. Nothing from it is shown or paid. Ink only. */
export function NetworkMismatchBanner({ selected, got }: { selected: string; got: string }) {
  return (
    <div role="alert" className="flex items-center gap-4 rounded-md border border-ink bg-surface-2 px-5 py-4">
      <Chip tone="solid">Wrong network</Chip>
      <div className="flex flex-1 flex-col gap-1">
        <p className="body-default text-ink">
          This Shark host serves {got}, not {selected}.
        </p>
        <p className="body-small text-muted">Nothing from it is shown and nothing can be paid until they match. Check the API address.</p>
      </div>
      <p className="mono-small whitespace-nowrap text-muted">
        {got} ≠ {selected}
      </p>
    </div>
  );
}

/** One state of the flow. Every state says, in one line, what happened to the money. */
export function StateCard({ title, chip, money, children }: { title: string; chip: ReactNode; money: string; children?: ReactNode }) {
  return (
    <section aria-live="polite" className="flex flex-col gap-4 rounded-pane border border-line bg-surface p-6">
      <div className="flex items-center gap-3">
        <h3 className="display-m flex-1 text-ink">{title}</h3>
        <Chip tone="solid">{chip}</Chip>
      </div>
      {children}
      <p className="mono-small text-muted">your money: {money}</p>
    </section>
  );
}
