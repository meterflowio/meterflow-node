import type { MeterFlowOptions, RequestOptions } from "../client";
import { version as PACKAGE_VERSION } from "../../package.json";
import {
  MeterFlowError,
  AuthError,
  NotFoundError,
  InsufficientCreditsError,
  ConflictError,
  PayloadTooLargeError,
  ValidationError,
  RateLimitError,
  ServerError,
  type ValidationFieldError,
} from "../errors";
import { retryable } from "./retry";

// Read from package.json at build time (esbuild inlines it), so the release script's
// `npm version` bump is the only place the number lives. It was a hand-maintained literal
// before and had been reporting 0.2.0 for two releases.
const SDK_VERSION: string = PACKAGE_VERSION;

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

interface ParsedError {
  message: string;
  fields: ValidationFieldError[];
}

function isFieldError(value: unknown): value is ValidationFieldError {
  return typeof value === "object" && value !== null && typeof (value as ValidationFieldError).field === "string" && typeof (value as ValidationFieldError).message === "string";
}

/**
 * The MeterFlow API answers every error as `{ error: { code, message, fields? } }`
 * (app/api/src/exceptions.py). `detail` is FastAPI's default shape, kept only as a fallback so
 * an unexpected passthrough still yields a readable message rather than a JSON blob.
 */
async function parseErrorBody(response: Response): Promise<ParsedError> {
  try {
    const json = (await response.json()) as Record<string, unknown>;
    const error = json["error"];
    if (typeof error === "object" && error !== null) {
      const body = error as Record<string, unknown>;
      const fields = Array.isArray(body["fields"]) ? body["fields"].filter(isFieldError) : [];
      if (typeof body["message"] === "string") {
        // A 422's headline is always "Validation failed"; the field list is what the caller needs.
        const detail = fields.map((f) => `${f.field}: ${f.message}`).join("; ");
        return { message: detail ? `${body["message"]}: ${detail}` : body["message"], fields };
      }
    }
    if (typeof json["detail"] === "string") return { message: json["detail"], fields: [] };
    return { message: JSON.stringify(json), fields: [] };
  } catch {
    return { message: response.statusText || `HTTP ${response.status}`, fields: [] };
  }
}

function mapResponseError(status: number, parsed: ParsedError, requestId: string | undefined, response: Response): MeterFlowError {
  const { message, fields } = parsed;
  if (status === 401 || status === 403) return new AuthError(message, requestId, status);
  if (status === 402) return new InsufficientCreditsError(message, requestId);
  if (status === 404) return new NotFoundError(message, requestId);
  if (status === 409) return new ConflictError(message, requestId);
  if (status === 413) return new PayloadTooLargeError(message, requestId);
  if (status === 422) return new ValidationError(message, requestId, fields);
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
        const parsed = await parseErrorBody(response);
        throw mapResponseError(response.status, parsed, requestId, response);
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
