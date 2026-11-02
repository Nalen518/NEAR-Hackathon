// API §0.1 error shape. `charged` is on every error: nothing Shark answers with an error ever charged anyone.
import type { ErrorCode } from "@shark/shared";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export function sendError(c: Context, e: HttpError) {
  if (e.retryAfter !== undefined) c.header("Retry-After", String(Math.ceil(e.retryAfter)));
  return c.json({ error: e.code, message: e.message, charged: false, ...(e.details ? { details: e.details } : {}) }, e.status);
}
