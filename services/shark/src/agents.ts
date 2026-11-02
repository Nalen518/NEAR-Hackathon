// Files for workers and Owl (API §1.11). Every request is signed by the agent's NEAR access key:
// headers X-Agent-Account, X-Agent-Key, X-Agent-Ts and X-Agent-Sig (base64 ed25519) over
// "sharkco:agent:v1|METHOD|PATH|TS|<hex sha256 of the body>". Snapshots and briefs never go to anyone else.
import type { Context, Hono } from "hono";
import { PublicKey } from "near-api-js";
import type { Chain } from "./chain";
import type { Config } from "./config";
import { HttpError } from "./errors";
import { MAX_BYTES } from "./input";
import { sha256, sha256Ref } from "./quote";
import type { Store } from "./store";

const MAX_AGE_SECS = 300;

export const agentMessage = (method: string, path: string, ts: number, body: string) => `sharkco:agent:v1|${method}|${path}|${ts}|${sha256(body).toString("hex")}`;

export function agentRoutes(app: Hono, d: { config: Config; chain: Chain; store: Store; now: () => number }) {
  const agents = new Set(Object.values(d.config.agents).filter((a): a is string => !!a));

  async function agent(c: Context, body: string): Promise<string> {
    const deny = (why: string) => new HttpError(401, "payer_signature_invalid", `Agent request refused: ${why}.`);
    const account = c.req.header("X-Agent-Account") ?? "";
    const key = c.req.header("X-Agent-Key") ?? "";
    const ts = Number(c.req.header("X-Agent-Ts"));
    const sig = Buffer.from(c.req.header("X-Agent-Sig") ?? "", "base64");
    if (!agents.has(account)) throw deny("not a registered agent");
    if (!Number.isInteger(ts) || Math.abs(d.now() - ts) > MAX_AGE_SECS) throw deny("stale timestamp");
    let ok = false;
    try {
      ok = PublicKey.from(key).verify(new TextEncoder().encode(agentMessage(c.req.method, c.req.path, ts, body)), sig);
    } catch {
      ok = false;
    }
    if (!ok) throw deny("bad signature");
    if (!(await d.chain.isAccessKey(account, key))) throw deny("key is not on the account");
    return account;
  }

  app.get("/v1/files/:hash", async (c) => {
    await agent(c, "");
    const text = d.store.blob(c.req.param("hash"));
    if (text === null) throw new HttpError(404, "invalid_request", "No file with that hash.");
    return c.text(text);
  });

  /** Owl reads the customer's order text to judge a complaint (brief vs order, FR-51). The text is not on chain. */
  app.get("/v1/agent/orders/:id", async (c) => {
    const account = await agent(c, "");
    if (account !== d.config.agents.owl) throw new HttpError(403, "not_payer", "Only the reviewer reads order text.");
    const job = await d.chain.job(Number(c.req.param("id")));
    const row = job && d.store.quote(job.quote_id);
    if (!row) throw new HttpError(404, "order_not_found", "There is no job with that number.");
    return c.json({ instructions: row.instructions });
  });

  /** Workers store a delivery; the answer is its hash, which they pass to `deliver` on chain. */
  app.put("/v1/files", async (c) => {
    const body = await c.req.text();
    if (Buffer.byteLength(body) > MAX_BYTES) throw new HttpError(413, "input_too_large", "Deliveries are limited to 2 MB.");
    await agent(c, body);
    const hash = sha256Ref(body);
    d.store.putBlob(hash, body);
    return c.json({ hash });
  });
}
