"use client";
import { NETWORKS, useNetwork } from "@/lib/network";

/** Nav badge: the build is testnet only, so the network is fixed and always visible. */
export function NetworkSwitch() {
  const { network } = useNetwork();
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="mono-chip flex items-center gap-1 rounded-pill bg-ink px-3 py-1 text-surface">
        <span aria-hidden className="size-1.5 rounded-full bg-accent" />
        {network}
      </span>
      <p className="mono-small whitespace-nowrap text-muted">{NETWORKS[network].caption}</p>
    </div>
  );
}

/** In-content badge naming the deployment a widget reads from. */
export function NetworkBadge() {
  const { network } = useNetwork();
  return (
    <span className="mono-chip inline-flex shrink-0 items-center gap-2 rounded-pill border border-dashed border-accent px-3 py-1 text-accent">
      <span aria-hidden className="size-1.5 rounded-full bg-accent" />
      {network}
    </span>
  );
}
