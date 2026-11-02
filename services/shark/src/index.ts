import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { rpcChain } from "./chain";
import { loadConfig } from "./config";
import { openStore } from "./store";

const config = loadConfig();
const chain = rpcChain({ rpcUrl: config.rpcUrl, contractId: config.contractId, usdcId: config.usdcId, sharkId: config.sharkId ?? undefined, sharkKey: config.sharkKey ?? undefined });
const app = createApp({ config, chain, store: openStore(config.fileStorePath) });
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(JSON.stringify({ level: "info", msg: "shark listening", port, network: config.networkId })));
