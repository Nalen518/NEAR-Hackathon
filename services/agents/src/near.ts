// What an agent needs from NEAR and from Shark: contract views, its own two calls (`deliver` for workers,
// `on_review` for Owl), and signed requests to Shark's file store (API §1.11).
import { createHash } from "node:crypto";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, type KeyPairString } from "near-api-js";

export type JobState = "paid" | "awarded" | "review" | "revision" | "failed" | "dispute_review" | "unresolved" | "delivered" | "complaint_review" | "finalized" | "refund_due" | "refunded";
export type Job = {
  id: number;
  job_type: "extract" | "summary" | "thread";
  state: JobState;
  worker: string | null;
  escrowed: boolean;
  round: number;
  input_hash: string;
  brief_hash: string;
  delivery_hash: string | null;
  complaint_hash: string | null;
  codes: string[];
};
export type Worker = { id: string; types: Job["job_type"][]; min_fees: string[]; suspended: boolean };
export type ReviewResult = { mode: "primary" | "secondary" | "complaint"; pass: boolean; codes: string[]; reasons_hash: string };

export type AgentChain = {
  jobCount(): Promise<number>;
  jobs(from: number, limit: number): Promise<Job[]>;
  job(id: number): Promise<Job | null>;
  workers(): Promise<Worker[]>;
  deliver(job: number, deliveryHash: string): Promise<void>;
  onReview(job: number, result: ReviewResult): Promise<void>;
  /** The awarded worker contests a final fail (FR-45). */
  dispute(job: number): Promise<void>;
};

export function rpcAgentChain(o: { rpcUrl: string; contractId: string; accountId: string; key: string }): AgentChain {
  const provider = new JsonRpcProvider({ url: o.rpcUrl });
  const me = new Account(o.accountId, provider, KeyPairSigner.fromSecretKey(o.key as KeyPairString));
  const view = <T>(method: string, args: Record<string, unknown> = {}) =>
    provider.callFunction({ contractId: o.contractId, method, args, blockQuery: { finality: "final" } }) as Promise<T>;
  const call = async (methodName: string, args: Record<string, unknown>) => {
    await me.callFunctionRaw({ contractId: o.contractId, methodName, args, gas: 100_000_000_000_000n, deposit: 0n, waitUntil: "FINAL" });
  };
  return {
    jobCount: async () => (await view<{ jobs: number }>("get_stats")).jobs,
    jobs: (from, limit) => view<Job[]>("get_jobs", { from, limit }),
    job: (id) => view<Job | null>("get_job", { job: id }),
    workers: () => view<Worker[]>("get_workers"),
    deliver: (job, deliveryHash) => call("deliver", { job, delivery_hash: deliveryHash }),
    onReview: (job, result) => call("on_review", { job, result }),
    dispute: (job) => call("dispute", { job }),
  };
}

export const sha256Ref = (s: string) => `sha256:${createHash("sha256").update(s).digest("hex")}`;

/** Same message Shark checks in services/shark/src/agents.ts. */
export const agentMessage = (method: string, path: string, ts: number, body: string) =>
  `sharkco:agent:v1|${method}|${path}|${ts}|${createHash("sha256").update(body).digest("hex")}`;

export type Files = {
  /** A file by hash, checked against the hash; null if Shark doesn't have it. */
  get(hash: string): Promise<string | null>;
  put(body: string): Promise<string>;
  orderText(jobId: number): Promise<string>;
};

export function sharkFiles(o: { sharkUrl: string; accountId: string; key: string; now?: () => number; fetchImpl?: typeof fetch }): Files {
  const kp = KeyPair.fromString(o.key as KeyPairString);
  const now = o.now ?? (() => Math.floor(Date.now() / 1000));
  const f = o.fetchImpl ?? fetch;
  const req = (method: "GET" | "PUT", path: string, body = "") => {
    const ts = now();
    const sig = kp.sign(new TextEncoder().encode(agentMessage(method, path, ts, body))).signature;
    return f(`${o.sharkUrl}${path}`, {
      method,
      body: method === "GET" ? undefined : body,
      headers: { "X-Agent-Account": o.accountId, "X-Agent-Key": kp.getPublicKey().toString(), "X-Agent-Ts": String(ts), "X-Agent-Sig": Buffer.from(sig).toString("base64") },
    });
  };
  return {
    async get(hash) {
      const res = await req("GET", `/v1/files/${hash}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`files ${res.status}`);
      const text = await res.text();
      if (sha256Ref(text) !== hash) throw new Error(`hash mismatch for ${hash}`);
      return text;
    },
    async put(body) {
      const res = await req("PUT", "/v1/files", body);
      if (!res.ok) throw new Error(`files ${res.status}`);
      return ((await res.json()) as { hash: string }).hash;
    },
    async orderText(jobId) {
      const res = await req("GET", `/v1/agent/orders/${jobId}`);
      if (!res.ok) throw new Error(`order text ${res.status}`);
      return ((await res.json()) as { instructions: string }).instructions;
    },
  };
}

/** NEAR AI Cloud (OpenAI compatible, API §5.2 #1). `json` asks for a JSON object back. */
export type Model = (system: string, user: string, json?: boolean) => Promise<string>;
export function nearAi(o: { baseUrl: string; apiKey: string; model: string; fetchImpl?: typeof fetch }): Model {
  return async (system, user, json) => {
    const res = await (o.fetchImpl ?? fetch)(`${o.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${o.apiKey}` },
      body: JSON.stringify({ model: o.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.2, ...(json ? { response_format: { type: "json_object" } } : {}) }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`NEAR AI ${res.status}`);
    return ((await res.json()) as { choices: { message: { content: string } }[] }).choices[0].message.content;
  };
}

/** Model output often wraps JSON in a code fence. */
export const stripFence = (s: string) => s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
