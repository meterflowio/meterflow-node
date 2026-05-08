import type { MeterFlowOptions, RequestOptions } from "../client";
import {
  MeterFlowError,
  AuthError,
  NotFoundError,
  InsufficientCreditsError,
  ConflictError,
  ValidationError,
  RateLimitError,
  ServerError,
} from "../errors";
import { retryable } from "./retry";

const SDK_VERSION = "0.1.0";

function buildUrl(baseUrl: string, path: string, query?: Record<string, string | number | boolean>): string {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function buildHeaders(options: Required<MeterFlowOptions>, opts?: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.apiKey}`,
    "User-Agent": `meterflow-node/${SDK_VERSION}`,
    Accept: "application/json",
  };
  if (opts?.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (opts?.idempotencyKey) {
    headers["Idempotency-Key"] = opts.idempotencyKey;
  }
  return headers;
}

async function parseErrorBody(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as Record<string, unknown>;
    if (typeof json["detail"] === "string") return json["detail"];
    return JSON.stringify(json);
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
}

function mapResponseError(status: number, message: string, requestId: string | undefined, response: Response): MeterFlowError {
  if (status === 401 || status === 403) return new AuthError(message, requestId, status);
  if (status === 402) return new InsufficientCreditsError(message, requestId);
  if (status === 404) return new NotFoundError(message, requestId);
  if (status === 409) return new ConflictError(message, requestId);
  if (status === 422) return new ValidationError(message, requestId);
  if (status === 429) {
    const retryAfterRaw = response.headers.get("Retry-After");
    const retryAfter = retryAfterRaw != null ? parseInt(retryAfterRaw, 10) : undefined;
    return new RateLimitError(message, Number.isFinite(retryAfter) ? retryAfter : undefined, requestId);
  }
  if (status >= 500) return new ServerError(message, requestId, status);
  return new MeterFlowError(message, "request_error", false, requestId, status);
}

export async function httpRequest<T>(
  options: Required<MeterFlowOptions>,
  method: string,
  path: string,
  opts?: RequestOptions,
): Promise<T> {
  const url = buildUrl(options.baseUrl, path, opts?.query);
  const headers = buildHeaders(options, opts);
  const body = opts?.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const timeoutMs = opts?.timeout ?? options.timeout;

  return retryable<T>(
    async () => {
      const signal = AbortSignal.timeout(timeoutMs);
      const fetchInit: RequestInit = { method, headers, signal };
      if (body !== undefined) fetchInit.body = body;
      const response = await options.fetch(url, fetchInit);

      const requestId = response.headers.get("x-request-id") ?? undefined;

      if (!response.ok) {
        const message = await parseErrorBody(response);
        throw mapResponseError(response.status, message, requestId, response);
      }

      if (response.status === 204 || response.headers.get("content-length") === "0") {
        return undefined as T;
      }

      return (await response.json()) as T;
    },
    { retries: options.retries, factor: 2, jitter: true, maxDelayMs: 10_000 },
    (err) => {
      if (err instanceof MeterFlowError) return err.retryable;
      return true;
    },
  );
}
