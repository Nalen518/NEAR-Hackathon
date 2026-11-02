import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { rpcChain } from "./chain";
import { loadConfig } from "./config";
import { tick } from "./loop";
import { openStore } from "./store";

const config = loadConfig();
const chain = rpcChain({
  rpcUrl: config.rpcUrl,
  contractId: config.contractId,
  usdcId: config.usdcId,
  sharkId: config.sharkId ?? undefined,
  sharkKey: config.sharkKey ?? undefined,
  walletId: config.walletId ?? undefined,
  walletKey: config.walletKey ?? undefined,
});
const store = openStore(config.fileStorePath);
const now = () => Math.floor(Date.now() / 1000);
const app = createApp({ config, chain, store, now });
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(JSON.stringify({ level: "info", msg: "shark listening", port, network: config.networkId })));

// job loop every 15 s (ARCHITECTURE §7); one tick at a time
let running = false;
setInterval(async () => {
  if (running) return;
  running = true;
  try {
    await tick({ config, chain, store, now });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "tick failed", error: String(e) }));
  } finally {
    running = false;
  }
}, 15_000);
