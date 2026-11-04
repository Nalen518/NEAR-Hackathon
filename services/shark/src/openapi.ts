// GET /v1/openapi.json (API §1.12, FR-14): OpenAPI 3.1 for agent frameworks, including the 402 and x402 flow.
// Schemas come straight from the shared zod schemas the API validates with, so the document can't drift from them.
import { ApiError, Company, ComplaintAccepted, ComplaintRequest, Health, Order, OrderAccepted, OrderPayer, OrderRequest, PaymentOptions, Prices, Quote402, QuoteStatus, SignedMessage, UploadResult } from "@shark/shared";
import { z } from "zod";
import type { Config } from "./config";

const schema = (s: z.ZodType, io: "input" | "output" = "output") => z.toJSONSchema(s, { target: "draft-2020-12", unrepresentable: "any", io });
const json = (s: z.ZodType, io: "input" | "output" = "output") => ({ "application/json": { schema: schema(s, io) } });
const error = (description: string) => ({ description, content: json(ApiError) });

const pathParam = (name: string, description: string) => ({ name, in: "path", required: true, description, schema: { type: "string" } });
const retryAfter = { "Retry-After": { description: "Whole seconds to wait", schema: { type: "integer" } } };

export function openApi(config: Config) {
  const orderId = pathParam("orderId", "j_ followed by at least 6 digits, e.g. j_000042");
  const errors = {
    "400": error("Bad request: `details.field` names the field. Nothing was charged"),
    "429": { ...error("Too many requests, or 3 complaints a day"), headers: retryAfter },
    "502": { ...error("NEAR, the file fetch or the model is down. Nothing was charged"), headers: retryAfter },
    "503": { ...error("Service state: closed, paused, caged, no_worker or out_of_budget. Nothing was charged"), headers: retryAfter },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "Shark & Co. API",
      version: config.version,
      description: [
        `Order small jobs (extract, summary, thread) from an AI agency. This host serves one network: ${config.networkId}. Every response states it.`,
        "Payment is the authentication. POST /v1/orders answers 402 with a signed quote and the brief.",
        "Pay it in one of two ways. Method 1: call ft_transfer_call on the USDC token with `pay` from the 402 body, then poll /v1/quotes/{quoteId}.",
        "Method 3 (x402 v2): the same 402 carries a PAYMENT-REQUIRED header. Sign a NEP-366 delegate for one ft_transfer, then repeat the same POST with a PAYMENT-SIGNATURE header. The 200 answer carries PAYMENT-RESPONSE.",
        "Money is a decimal string in USDC with at most 6 decimals. Times are ISO 8601 UTC.",
      ].join(" "),
    },
    servers: [{ url: config.publicBaseUrl }],
    paths: {
      "/v1/health": { get: { summary: "Service state, network, contract and version", responses: { "200": { description: "OK", content: json(Health) } } } },
      "/v1/prices": { get: { summary: "Price bands and floors per job type, and recent quotes", responses: { "200": { description: "OK", content: json(Prices) } } } },
      "/v1/payment-options": { get: { summary: "How to pay on this network", responses: { "200": { description: "OK", content: json(PaymentOptions) } } } },
      "/v1/company": { get: { summary: "The company's live state: reserve, workers, reviewer, payouts, limits", responses: { "200": { description: "OK", content: json(Company) } } } },
      "/v1/uploads": {
        post: {
          summary: "Upload an input file (PDF, HTML, TXT or MD, at most 2 MB)",
          requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" } } } } } },
          responses: { "200": { description: "OK", content: json(UploadResult) }, "413": error("Over 2 MB, 20 pages or 40 000 words"), "422": error("The file can't be read") },
        },
      },
      "/v1/orders": {
        post: {
          summary: "Place an order. Answers 402 with the quote, or settles an x402 payment",
          parameters: [
            { name: "Idempotency-Key", in: "header", required: false, description: "The same key and body within 10 minutes gives the same answer", schema: { type: "string" } },
            { name: "PAYMENT-SIGNATURE", in: "header", required: false, description: "x402 v2 PaymentPayload, base64 JSON. Repeat the order that returned the 402", schema: { type: "string" } },
          ],
          requestBody: { required: true, content: json(OrderRequest, "input") },
          responses: {
            "402": {
              description: "The quote: price, the brief, the signed quote and how to pay it",
              headers: {
                "WWW-Authenticate": { description: 'SharkQuote quote_id="q_..."', schema: { type: "string" } },
                "PAYMENT-REQUIRED": { description: "x402 v2 PaymentRequired, base64 JSON, when x402 is enabled", schema: { type: "string" } },
              },
              content: json(Quote402),
            },
            "200": { description: "x402 payment settled", headers: { "PAYMENT-RESPONSE": { description: "x402 SettlementResponse, base64 JSON", schema: { type: "string" } } }, content: json(OrderAccepted) },
            "202": { description: "Already paid: the order that quote became", content: json(OrderAccepted) },
            "409": error("Idempotency-Key used with another body"),
            "410": error("The quote expired, or has under 150 s left for an x402 payment"),
            "422": error("Refused, infeasible (with `details.fixes`), unreadable or unsupported"),
            ...errors,
          },
        },
      },
      "/v1/quotes/{quoteId}": {
        get: {
          summary: "Where a quote stands: AWAITING_PAYMENT, PAID (with the orderId), EXPIRED or RETURNED",
          parameters: [pathParam("quoteId", "q_ followed by a ULID")],
          responses: { "200": { description: "OK", content: json(QuoteStatus) }, "400": errors["400"] },
        },
      },
      "/v1/orders/{orderId}": {
        get: { summary: "The public view of an order: price, timeline, auction, reviews, proof. Never the instructions, source or delivery", parameters: [orderId], responses: { "200": { description: "OK", content: json(Order) }, "404": error("No such order") } },
      },
      "/v1/orders/{orderId}/view": {
        post: {
          summary: "The payer's view, after a NEP-413 signature of `sharkco:view:<orderId>:<unix seconds>` (recipient: the contract, fresh 32 byte nonce, at most 5 minutes old)",
          parameters: [orderId],
          requestBody: { required: true, content: json(SignedMessage, "input") },
          responses: { "200": { description: "OK, never cached", headers: { "Cache-Control": { schema: { type: "string", const: "private, no-store" } } }, content: json(OrderPayer) }, "401": error("Missing, old, reused or wrong signature"), "403": error("Valid signature, but not the payer"), "404": error("No such order") },
        },
      },
      "/v1/orders/{orderId}/complaint": {
        post: {
          summary: "Complain within the window, signing `sharkco:complain:<orderId>:<unix seconds>` as the payer",
          parameters: [orderId],
          requestBody: { required: true, content: json(ComplaintRequest, "input") },
          responses: { "202": { description: "Under review", content: json(ComplaintAccepted) }, "401": error("Missing, old, reused or wrong signature"), "403": error("Not the payer"), "404": error("No such order"), "409": error("Window over or already complained"), "429": errors["429"] },
        },
      },
    },
  };
}
