import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { rpcChain } from "./chain";
import { loadConfig } from "./config";

const config = loadConfig();
const app = createApp({ config, chain: rpcChain(config.rpcUrl, config.contractId) });
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(JSON.stringify({ level: "info", msg: "shark listening", port, network: config.networkId })));
