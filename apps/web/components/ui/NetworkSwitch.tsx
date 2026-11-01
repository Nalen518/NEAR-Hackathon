"use client";
import { NETWORKS, useNetwork, type Network } from "@/lib/network";
import { cx } from "./primitives";

const ORDER: Network[] = ["testnet", "mainnet"];

/** D-149 nav switch. Ink/accent only; the selected network is always visible. */
export function NetworkSwitch() {
  const { network, setNetwork } = useNetwork();
  const i = ORDER.indexOf(network);
  return (
    <div className="flex flex-col items-end gap-1">
      <div role="radiogroup" aria-label="Network" className="relative grid grid-cols-2 gap-0.5 rounded-pill border border-line-strong bg-surface p-1">
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 w-[calc(50%-5px)] rounded-pill bg-ink transition-transform duration-150 ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(${i * 100}%) translateX(${i * 2}px)` }}
        />
        {ORDER.map((n) => (
          <button
            key={n}
            role="radio"
            aria-checked={n === network}
            onClick={() => setNetwork(n)}
            className={cx(
              "mono-chip relative z-10 flex items-center justify-center gap-1 rounded-pill px-3 py-1 transition-colors duration-150",
              n === network ? "text-surface" : "text-muted hover:text-ink",
            )}
          >
            {n === network && <span aria-hidden className="size-1.5 rounded-full bg-accent" />}
            {n}
          </button>
        ))}
      </div>
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
