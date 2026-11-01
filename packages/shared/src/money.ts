// Money helpers (RULES §4.3, prompt rule 5): USDC is a decimal string in HTTP and
// U128 base units (6 dp) on-chain. Never parse money into a JS number.

export type Usdc = string;
export type Network = "testnet" | "mainnet";

export const USDC_DECIMALS = 6;
const SCALE = 10n ** BigInt(USDC_DECIMALS);
export const USDC_RE = /^\d+(\.\d{1,6})?$/;

export function isUsdc(v: unknown): v is Usdc {
  return typeof v === "string" && USDC_RE.test(v);
}

export function toBase(v: Usdc): bigint {
  if (!isUsdc(v)) throw new Error(`Not a USDC amount: ${JSON.stringify(v)}`);
  const [int, frac = ""] = v.split(".");
  return BigInt(int) * SCALE + BigInt(frac.padEnd(USDC_DECIMALS, "0"));
}

/** Base units → decimal string with at least 2 dp ("1.00", "0.075"). */
export function fromBase(b: bigint): Usdc {
  const neg = b < 0n;
  const abs = neg ? -b : b;
  const frac = (abs % SCALE).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${neg ? "-" : ""}${abs / SCALE}.${frac}`;
}

/** "1" → "1.00 test USDC" on testnet, "1.00 USDC" on mainnet. `unit: false` drops the unit. */
export function formatUsdc(v: Usdc, opts: { network: Network; unit?: boolean }): string {
  const n = fromBase(toBase(v));
  if (opts.unit === false) return n;
  return `${n} ${opts.network === "testnet" ? "test USDC" : "USDC"}`;
}

/** Integer bps → percent string, rounded half away from zero. 1234 → "12.34%"; signed adds "+". */
export function bpsToPct(bps: number, opts: { dp?: 0 | 1 | 2; signed?: boolean } = {}): string {
  if (!Number.isInteger(bps)) throw new Error(`bps must be an integer: ${bps}`);
  const dp = opts.dp ?? 2;
  const div = 10 ** (2 - dp);
  const abs = Math.abs(bps);
  const scaled = Math.floor((abs + div / 2) / div); // bps are small ints, so this stays exact
  const s = dp === 0 ? `${scaled}` : `${Math.floor(scaled / 10 ** dp)}.${String(scaled % 10 ** dp).padStart(dp, "0")}`;
  const sign = bps < 0 ? "−" : opts.signed && bps > 0 ? "+" : "";
  return `${sign}${s}%`;
}

/** Sum of USDC strings, exact. */
export function addUsdc(...vs: Usdc[]): Usdc {
  return fromBase(vs.reduce((acc, v) => acc + toBase(v), 0n));
}

