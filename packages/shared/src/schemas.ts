// zod schemas for the Shark HTTP API (docs/API-CONTRACT.md v2.2 §0–§1, §4.1),
// plus the web's v2.3 proposal (docs/web/API-CHANGE-PROPOSAL-v2.3.md), marked `v2.3 Pn`.
// A parse failure is a contract bug: never loosen a schema to make live data pass.
import { z } from "zod";
import { USDC_RE } from "./money";

export const UsdcAmount = z.string().regex(USDC_RE, "USDC decimal string, ≤ 6 dp");
export const BaseUnits = z.string().regex(/^\d+$/);
export const IsoTime = z.iso.datetime();
export const OrderId = z.string().regex(/^j_\d{6,}$/);
export const QuoteId = z.string().regex(/^q_[0-9A-Z]+$/);
export const FileId = z.string().regex(/^f_[0-9A-Z]+$/);
export const Sha256 = z.string().regex(/^sha256:/);
/** CAIP-2 (§0). */
export const NearNetwork = z.enum(["near:testnet", "near:mainnet"]);
export const JobType = z.enum(["extract", "summary", "thread"]);
export type JobType = z.infer<typeof JobType>;
export const WorkerId = z.enum(["crab", "raven"]);
export type WorkerId = z.infer<typeof WorkerId>;
export const PayoutChain = z.enum(["near", "base"]);
export const PayMethod = z.enum(["quote", "intents", "x402"]);

// §0.2 (+ v2.3 P1/P2)
export const ERROR_CODES = [
  "invalid_request",
  "invalid_payer",
  "invalid_refund_to",
  "network_mismatch",
  "idempotency_conflict",
  "quote_expired",
  "input_too_large",
  "input_unreadable",
  "job_refused",
  "brief_infeasible",
  "unsupported_job_type",
  "unsupported_payment_asset",
  "amount_below_minimum",
  "intents_unavailable",
  "x402_invalid",
  "x402_settlement_failed",
  "payer_signature_invalid",
  "not_payer",
  "order_not_found",
  "complaint_closed",
  "rate_limited",
  "upstream_unavailable",
  "closed",
  "paused",
  "caged",
  "no_worker",
  "out_of_budget",
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Service states in check order (§0.2, D-146). */
export const SERVICE_STATES = ["closed", "paused", "caged", "no_worker", "out_of_budget"] as const;
export const ServiceState = z.enum(["ok", ...SERVICE_STATES]);
export type ServiceState = z.infer<typeof ServiceState>;

export const ApiError = z.object({
  error: ErrorCode,
  message: z.string(),
  charged: z.boolean().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ApiError = z.infer<typeof ApiError>;

export const Band = z.object({ min: UsdcAmount, max: UsdcAmount });

// §4.1 params per job type
export const ExtractParams = z.object({
  schema: z.object({
    fields: z
      .array(
        z.object({
          name: z.string().min(1),
          type: z.enum(["string", "number", "date", "url", "enum"]),
          required: z.boolean(),
          values: z.array(z.string()).optional(),
        }),
      )
      .min(1)
      .max(20),
  }),
  many: z.boolean().optional(),
  maxRecords: z.number().int().min(1).max(200).optional(),
}).strict();
export const SummaryParams = z.object({
  maxWords: z.number().int().min(30).max(500).optional(),
  mustMention: z.array(z.string()).max(5).optional(),
  language: z.string().optional(),
  format: z.enum(["paragraph", "bullets"]).optional(),
}).strict();
export const ThreadParams = z.object({
  posts: z.number().int().min(2).max(10).optional(),
  mustInclude: z.array(z.string()).max(5).optional(),
  tone: z.enum(["neutral", "friendly", "bold"]).optional(),
  topic: z.string().optional(),
}).strict();
// Strict, so the all optional SummaryParams no longer swallows (and strips) thread params; the three share no keys
export const Params = z.union([ExtractParams, SummaryParams, ThreadParams]);

// §1.1
export const UploadResult = z.object({
  fileId: FileId,
  bytes: z.number().int(),
  pages: z.number().int(),
  words: z.number().int(),
  inputHash: Sha256,
});
export type UploadResult = z.infer<typeof UploadResult>;

// §1.2
export const OrderInput = z.union([
  z.object({ url: z.url() }),
  z.object({ fileId: FileId }),
  z.object({ text: z.string().min(1) }),
]);
export const OrderRequest = z.object({
  jobType: JobType,
  instructions: z.string().min(1).max(2000),
  input: OrderInput.optional(), // thread may omit it
  params: Params.optional(),
  payer: z.string().min(2).max(64),
  referrer: z.string().optional(),
  payWith: z.object({ asset: z.string() }).optional(),
  refundTo: z.string().optional(),
});
export type OrderRequest = z.infer<typeof OrderRequest>;

export const CheckItem = z.object({ id: z.string(), kind: z.enum(["code", "model"]), rule: z.string() });
export type CheckItem = z.infer<typeof CheckItem>;
export const Brief = z.object({
  jobType: JobType,
  params: z.record(z.string(), z.unknown()),
  checklist: z.array(CheckItem),
  deliverableFormat: z.string(),
});
export type Brief = z.infer<typeof Brief>;

const ContractCall = z.object({ gas: BaseUnits, deposit: BaseUnits });

export const Quote402 = z.object({
  orderId: z.null(),
  quoteId: QuoteId,
  jobType: JobType,
  price: UsdcAmount,
  band: Band,
  floor: UsdcAmount,
  priceReason: z.string(),
  input: z.object({
    inputHash: Sha256,
    pages: z.number().int(),
    words: z.number().int(),
    source: z.string().nullable(),
  }),
  brief: Brief,
  briefHash: Sha256,
  quote: z.object({
    quote_id: QuoteId,
    network: NearNetwork,
    job_type: JobType,
    price: BaseUnits,
    payer: z.string(),
    input_hash: z.string(),
    brief_hash: z.string(),
    referrer: z.string().nullable().optional(),
    expires_at: z.number().int(),
  }),
  sig: z.string(),
  pay: ContractCall.extend({
    network: NearNetwork,
    token: z.string(),
    method: z.literal("ft_transfer_call"),
    args: z.object({ receiver_id: z.string(), amount: BaseUnits, msg: z.string() }),
  }),
  payerRegistered: z.boolean(),
  register: ContractCall.extend({
    contract: z.string(),
    method: z.literal("storage_deposit"),
    args: z.object({ account_id: z.string(), registration_only: z.boolean() }),
  }).nullable(),
  intents: z
    .object({
      asset: z.string(),
      chain: z.string(),
      amountIn: UsdcAmount,
      depositAddress: z.string(),
      refundTo: z.string(),
      deadline: IsoTime,
    })
    .nullable(),
  expiresAt: IsoTime,
  charged: z.literal(false),
});
export type Quote402 = z.infer<typeof Quote402>;

/** Decoded `PAYMENT-REQUIRED` header (x402 v2). Only shown in the For agents snippet. */
export const X402PaymentRequired = z.object({
  x402Version: z.literal(2),
  accepts: z.array(
    z.object({
      scheme: z.literal("exact"),
      network: NearNetwork,
      asset: z.string(),
      amount: BaseUnits,
      payTo: z.string(),
      maxTimeoutSeconds: z.number().int(),
      resource: z.string(),
      description: z.string(),
      extra: z.object({ quoteId: QuoteId, briefHash: z.string() }),
    }),
  ),
});

export const OrderAccepted = z.object({
  orderId: OrderId,
  status: z.literal("paid"),
  statusUrl: z.string(),
  payment: z.object({ method: PayMethod, tx: z.string() }).optional(),
});

// §1.3
export const QuoteStatus = z.object({
  quoteId: QuoteId,
  method: PayMethod,
  status: z.enum(["AWAITING_PAYMENT", "PAID", "EXPIRED", "RETURNED"]),
  orderId: OrderId.nullable(),
  paymentTx: z.string().nullable(),
  oneClickStatus: z.string().nullable(),
});
export type QuoteStatus = z.infer<typeof QuoteStatus>;

// §1.5
export const ORDER_STATUSES = [
  "paid",
  "awarded",
  "review",
  "revision",
  "failed",
  "dispute_review",
  "unresolved",
  "delivered",
  "complaint_review",
  "finalized",
  "refund_due",
  "refunded",
  "needs_review",
] as const;
export const OrderStatus = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const Bid = z.object({
  worker: WorkerId,
  price: UsdcAmount,
  etaSecs: z.number().int(),
  state: z.enum(["winner", "lost", "busy", "late", "invalid"]),
});
export type Bid = z.infer<typeof Bid>;
export const Auction = z.object({
  cap: UsdcAmount,
  bids: z.array(Bid),
  reason: z.string(),
  reasonHash: z.string().optional(), // v2.3 P3
});
export type Auction = z.infer<typeof Auction>;

// v2.3 P3: v2.2 lists only the first four.
export const TIMELINE_EVENTS = [
  "quoted",
  "paid",
  "awarded",
  "delivered_for_review",
  "review_pass",
  "review_fail",
  "revision_requested",
  "dispute",
  "second_review_pass",
  "second_review_fail",
  "unresolved",
  "worker_paid",
  "reviewer_paid",
  "complaint",
  "complaint_upheld",
  "complaint_rejected",
  "refund_due",
  "refunded",
  "finalized",
  "needs_review",
] as const;
export const TimelineEvent = z.object({
  at: IsoTime,
  event: z.enum(TIMELINE_EVENTS),
  worker: WorkerId.optional(),
  amount: UsdcAmount.optional(),
  round: z.number().int().optional(),
  tx: z.string().nullable().optional(),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const REVIEW_CODES = [
  "PASS",
  "FAIL_FORMAT",
  "FAIL_SCHEMA",
  "FAIL_LENGTH",
  "FAIL_MISSING_ITEM",
  "FAIL_TRACEABILITY",
  "FAIL_FAITHFULNESS",
  "FAIL_OFF_TOPIC",
  "FAIL_SAFETY",
  "BRIEF_INVALID",
  "HASH_MISMATCH",
  "REVIEW_ERROR",
  "COMPLAINT_UPHELD",
  "COMPLAINT_REJECTED",
] as const; // SRD §8.3
export const Review = z.object({
  round: z.number().int(),
  mode: z.enum(["primary", "secondary", "complaint"]),
  pass: z.boolean(),
  codes: z.array(z.enum(REVIEW_CODES)),
  reasons: z.string(),
  attestationUrl: z.string().nullable(),
  checks: z.array(z.object({ id: z.string(), pass: z.boolean(), detail: z.string().max(40).optional() })).optional(), // v2.3 P4 (should): detail for code checks only
});
export type Review = z.infer<typeof Review>;

export const Delivery = z.object({
  format: z.enum(["text/plain", "text/markdown", "application/json"]),
  content: z.string(),
  deliveryHash: Sha256,
});
export type Delivery = z.infer<typeof Delivery>;

const OrderBase = z.object({
  orderId: OrderId,
  status: OrderStatus,
  network: NearNetwork,
  jobType: JobType,
  price: UsdcAmount,
  briefHash: Sha256,
  inputHash: Sha256,
  timeline: z.array(TimelineEvent),
  auction: Auction.nullable(),
  reviews: z.array(Review),
  money: z
    .object({
      method: PayMethod,
      price: UsdcAmount,
      workerFee: UsdcAmount,
      reviewFee: UsdcAmount,
      referral: UsdcAmount,
      owners: UsdcAmount,
      reserve: UsdcAmount,
    })
    .nullable(),
  complaint: z.object({
    allowedUntil: IsoTime.nullable(),
    status: z.enum(["complaint_review", "upheld", "rejected"]).nullable(),
  }),
  refund: z.object({ to: z.string(), amount: UsdcAmount, reason: z.string(), tx: z.string().nullable() }).nullable(),
  proof: z.object({
    paymentTx: z.string().nullable(),
    awardTx: z.string().nullable().optional(), // v2.3 P3
    workerPayoutTx: z.string().nullable(),
    contractTxs: z.array(z.string()),
  }),
  sample: z.boolean(),
});

/** v2.3 P1: what anyone sees (D-166). No params, instructions, source or delivery. */
export const OrderPublic = OrderBase.extend({
  view: z.literal("public"),
  size: z.object({ pages: z.number().int(), words: z.number().int() }).optional(), // v2.3 P1: counts only, never the source
  brief: z.object({
    jobType: JobType,
    checklist: z.array(CheckItem.pick({ id: true, kind: true })),
  }),
});
export type OrderPublic = z.infer<typeof OrderPublic>;

/** v2.3 P1: after a NEP-413 signature from the payer. Never cached for others. */
export const OrderPayer = OrderBase.extend({
  view: z.literal("payer"),
  brief: Brief,
  instructions: z.string(),
  input: z.object({ source: z.string().nullable(), pages: z.number().int(), words: z.number().int() }),
  delivery: Delivery.nullable(),
});
export type OrderPayer = z.infer<typeof OrderPayer>;

export const Order = z.discriminatedUnion("view", [OrderPublic, OrderPayer]);
export type Order = z.infer<typeof Order>;

/** NEP-413 signMessage output (v2.3 P1). */
export const SignedMessage = z.object({
  accountId: z.string(),
  publicKey: z.string(),
  signature: z.string(),
  message: z.string().regex(/^sharkco:(view|complain):j_\d{6,}:\d+$/),
  nonce: z.string(),
  recipient: z.string(),
});
export type SignedMessage = z.infer<typeof SignedMessage>;
export const ComplaintRequest = z.object({ reason: z.string().min(1).max(1000), auth: SignedMessage }); // v2.3 P2
export type ComplaintRequest = z.infer<typeof ComplaintRequest>;
export const ComplaintAccepted = z.object({ status: z.literal("complaint_review") });

// §1.7 (+ v2.3 P5, could: optional, so v2.2 data still parses)
export const RecentQuote = z.object({
  at: IsoTime,
  jobType: JobType,
  price: UsdcAmount,
  reason: z.string(),
  status: z.enum(["paid", "expired", "returned"]).optional(),
  returnReason: z.enum(["E_PRICE_BELOW_FLOOR", "E_PRICE_OUT_OF_BAND"]).nullable().optional(), // the contract's payment_returned reason
  tx: z.string().nullable().optional(),
});
export const Prices = z.object({
  types: z.record(JobType, z.object({ band: Band, floor: UsdcAmount })),
  recentQuotes: z.array(RecentQuote),
});
export type Prices = z.infer<typeof Prices>;

// §1.8
export const PaymentOptions = z.object({
  network: NearNetwork,
  options: z.array(
    z.discriminatedUnion("method", [
      z.object({ method: z.literal("quote"), token: z.string(), label: z.string(), faucet: z.object({ url: z.string() }).nullable().optional() }),
      z.object({ method: z.literal("x402"), scheme: z.literal("exact"), network: NearNetwork, asset: z.string(), facilitator: z.string() }),
      z.object({ method: z.literal("intents"), asset: z.string(), chain: z.string(), minAmountIn: UsdcAmount, dryQuoteOk: z.boolean() }),
    ]),
  ),
});
export type PaymentOptions = z.infer<typeof PaymentOptions>;

// §1.9 (+ v2.3 P6)
/** Native gas token amount (ETH): decimal string, ≤ 18 dp. Never a float. */
export const EthAmount = z.string().regex(/^\d+(\.\d{1,18})?$/);

export const Worker = z.object({
  id: WorkerId,
  account: z.string(),
  payoutChain: PayoutChain,
  types: z.array(JobType),
  minFee: z.record(JobType, UsdcAmount),
  jobs: z.number().int(),
  firstPassPct: z.number().int().min(0).max(100),
  finalFails: z.number().int(),
  disputesWon: z.number().int(),
  disputesLost: z.number().int(),
  suspendThreshold: z.number().int(),
  unresolvedOpen: z.number().int(),
  maxUnresolvedOpen: z.number().int(),
  late: z.number().int(),
  suspended: z.boolean(),
  eligible: z.boolean(),
  ineligibleReason: z.enum(["suspended", "unresolved_cap", "min_fee_above_cap", "type_not_supported"]).nullable(),
});
export type Worker = z.infer<typeof Worker>;

export const LedgerJob = z.object({
  orderId: OrderId,
  jobType: JobType,
  price: UsdcAmount,
  worker: WorkerId.nullable(),
  payoutChain: PayoutChain.nullable(),
  status: OrderStatus,
  referral: UsdcAmount.nullable(),
  attestationUrl: z.string().nullable(),
  workerPayoutTx: z.string().nullable(),
  at: IsoTime.optional(), // v2.3 P6
  reserveDelta: UsdcAmount.nullable().optional(), // v2.3 P6
  refund: UsdcAmount.nullable().optional(), // v2.3 P6
});
export type LedgerJob = z.infer<typeof LedgerJob>;

export const AuctionRecord = z.object({
  orderId: OrderId,
  jobType: JobType,
  price: UsdcAmount,
  cap: UsdcAmount,
  bids: z.array(Bid),
  winner: WorkerId.nullable(),
  reason: z.string(),
  outcome: z.enum(["delivered", "dispute_won", "unresolved", "complaint", "refunded", "working"]),
});
export type AuctionRecord = z.infer<typeof AuctionRecord>;

export const Incident = z.object({
  at: IsoTime,
  orderId: OrderId.nullable(),
  kind: z.enum(["complaint_upheld", "complaint_rejected", "dispute", "dispute_won", "late", "brief_invalid", "strike"]),
  text: z.string(),
  strike: z.boolean(),
});
export type Incident = z.infer<typeof Incident>;

export const Payout = z.object({
  at: IsoTime,
  orderId: OrderId.nullable(),
  to: z.string(),
  kind: z.enum(["worker", "reviewer", "referral", "owner", "refund", "held"]),
  amount: UsdcAmount,
  chain: PayoutChain,
  tx: z.string().nullable(),
  held: z.boolean(),
});
export type Payout = z.infer<typeof Payout>;

const SampleMap = z.object({
  strikes: z.boolean(),
  reserve: z.boolean(),
  pnl7d: z.boolean(),
  prices: z.boolean(),
  workers: z.boolean(),
  reviewer: z.boolean(),
  recentJobs: z.boolean(),
  owners: z.boolean(),
  // v2.3 P6 core (should)
  config: z.boolean(),
  payouts: z.boolean(),
  guardian: z.boolean(),
  // v2.3 P6 extras (could): absent means not served yet, so the web shows sample data
  auctions: z.boolean().default(true),
  incidents: z.boolean().default(true),
});

export const Company = z.object({
  network: NearNetwork,
  state: ServiceState,
  strikes: z.object({ count: z.number().int(), threshold: z.number().int() }),
  reserve: z.object({
    balance: UsdcAmount,
    floor: UsdcAmount,
    sharkWallet: UsdcAmount,
    dailyBudget: UsdcAmount,
    ravenPayoutGas: z.object({
      balanceEth: EthAmount,
      payoutsLeft: z.number().int().nullable(),
      warnBelow: z.number().int(), // v2.3 P6
    }),
  }),
  pnl7d: z.object({
    jobs: z.number().int(),
    revenue: UsdcAmount,
    workers: UsdcAmount,
    reviews: UsdcAmount,
    referrals: UsdcAmount,
    profit: UsdcAmount,
    ownersPaid: UsdcAmount,
    ownersAccrued: UsdcAmount,
  }),
  prices: Prices,
  workers: z.array(Worker),
  reviewer: z.object({
    id: z.literal("owl"),
    account: z.string(),
    reviews: z.number().int(),
    overturned: z.number().int(),
    reviewFee: UsdcAmount,
    suspended: z.boolean(),
  }),
  recentJobs: z.array(LedgerJob),
  owners: z.object({
    dao: z.string(),
    approvalRule: z.string(),
    openProposals: z.array(z.object({ id: z.number().int(), title: z.string() })),
    proposals: z.array(
      z.object({
        id: z.number().int(),
        title: z.string(),
        status: z.enum(["open", "passed", "rejected"]),
        at: IsoTime,
        votes: z.string(),
      }),
    ), // v2.3 P6
    ownersWaiting: UsdcAmount, // v2.3 P6
    trezuUrl: z.string(),
  }),
  guardian: z.object({ account: z.string(), power: z.string() }),
  // v2.3 P6
  config: z.object({
    quoteTtlSecs: z.number().int(),
    workerCapBps: z.number().int(),
    reviewFee: UsdcAmount,
    referralBps: z.number().int(),
    ownerBps: z.number().int(),
    dailyBudget: UsdcAmount,
    reserveFloor: UsdcAmount,
    strikeThreshold: z.number().int(),
    suspendThreshold: z.number().int(),
    suspendWindowJobs: z.number().int(),
    unresolvedTimeoutSecs: z.number().int(),
    maxUnresolvedOpen: z.number().int(),
    complaintWindowSecs: z.number().int(),
    bands: z.record(JobType, Band),
    changedAt: IsoTime.nullable(),
    changedByProposal: z.number().int().nullable(),
    changeTx: z.string().nullable(),
  }),
  auctions: z.array(AuctionRecord).default([]), // v2.3 P6 extra (could)
  incidents: z.array(Incident).default([]), // v2.3 P6 extra (could)
  payouts: z.array(Payout),
  sample: SampleMap,
});
export type Company = z.infer<typeof Company>;
export type CompanySection = keyof Company["sample"];

// §1.10
export const Health = z.object({
  ok: z.boolean(),
  network: NearNetwork,
  state: ServiceState,
  contract: z.string(),
  version: z.string(),
});
export type Health = z.infer<typeof Health>;
