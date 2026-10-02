import { Agent, fetch } from "undici";

// A failed call to one of the other services, with enough detail for a log
// line to say which call, what status, and what the service said.
export class ServiceError extends Error {
  constructor(
    readonly call: string,
    readonly status: number | null,
    detail: string
  ) {
    super(`${call} ${status === null ? "failed" : `returned ${status}`}: ${detail}`);
  }
}

// Node's built-in fetch gives up if response headers don't arrive within
// 5 minutes, and an AbortSignal can't extend that - only a dispatcher can.
// Content Builder holds the connection open for its whole multi-minute run
// (docs/R2_BUILD-SPEC.md §4.5, §7.3), so each call gets an explicit budget.
export async function request(
  call: string,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs: number }
): Promise<{ status: number; text: string }> {
  const dispatcher = new Agent({ headersTimeout: init.timeoutMs, bodyTimeout: init.timeoutMs });
  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      dispatcher,
      signal: AbortSignal.timeout(init.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new ServiceError(call, res.status, text.slice(0, 300) || res.statusText);
    return { status: res.status, text };
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    const cause = (err as { cause?: Error }).cause;
    throw new ServiceError(call, null, `${(err as Error).message}${cause ? ` (${cause.message})` : ""}`);
  } finally {
    await dispatcher.close();
  }
}
