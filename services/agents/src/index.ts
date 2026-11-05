// One process per agent: AGENT_ROLE=crab|raven serves the worker API (API §2), AGENT_ROLE=owl runs the reviewer loop.
// Each agent has its own NEAR account and key (ARCHITECTURE §4); names follow API §5.1.
import { serve } from "@hono/node-server";
import { nearAi, rpcAgentChain, sharkFiles } from "./near";
import { reviewOnce } from "./owl";
import { createWorkerApp } from "./worker";

const env = process.env;
const role = env.AGENT_ROLE;
if (role !== "crab" && role !== "raven" && role !== "owl") throw new Error("AGENT_ROLE must be crab, raven or owl");
const NET = (env.SHARK_NETWORK ?? "testnet").toUpperCase();
const need = (name: string) => env[name] || (() => { throw new Error(`${name} is not set`); })();
const ROLE = role.toUpperCase();

const accountId = need(`${NET}_${ROLE}_ID`);
const key = need(`${ROLE}_KEY`);
const chain = rpcAgentChain({ rpcUrl: need(`${NET}_RPC_URL`), contractId: need(`${NET}_CONTRACT_ID`), accountId, key });
const files = sharkFiles({ sharkUrl: need(`${NET}_API_URL`).replace(/\/v1\/?$/, ""), accountId, key });
const baseUrl = env.NEARAI_BASE_URL ?? "https://cloud-api.near.ai/v1";
const model = nearAi({ baseUrl, apiKey: need("NEARAI_API_KEY"), model: need(`${ROLE}_MODEL`) });
// a second, different model for disputes (D-114); only Owl uses it
const secondaryModel = role === "owl" ? nearAi({ baseUrl, apiKey: need("NEARAI_API_KEY"), model: need("OWL_MODEL_SECONDARY") }) : undefined;

if (role === "owl") {
  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    await reviewOnce({ chain, files, model, secondaryModel }).catch((e) => console.error(JSON.stringify({ agent: "owl", level: "error", error: String(e) })));
    running = false;
  };
  setInterval(pass, 15_000);
  void pass();
} else {
  // SRD §1.3: Crab is the cheaper, slower one; Raven charges a little more per page and is faster
  const app = createWorkerApp({ name: role, accountId, key, sharkToken: need("SHARK_AGENT_TOKEN"), chain, files, model, perPage: role === "crab" ? 2_000n : 4_000n, etaSecs: role === "crab" ? 70 : 45 });
  const port = Number(env.PORT ?? (role === "crab" ? 8788 : 8789));
  serve({ fetch: app.fetch, port }, () => console.log(JSON.stringify({ agent: role, msg: "listening", port })));
}
