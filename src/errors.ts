export class MeterFlowError extends Error {
  readonly errorType: string;
  readonly requestId: string | undefined;
  readonly statusCode: number | undefined;
  readonly retryable: boolean;

  constructor(message: string, errorType: string, retryable: boolean, requestId?: string, statusCode?: number) {
    super(message);
    this.name = "MeterFlowError";
    this.errorType = errorType;
    this.retryable = retryable;
    this.requestId = requestId;
    this.statusCode = statusCode;
  }
}

export class AuthError extends MeterFlowError {
  constructor(message: string, requestId?: string, statusCode = 401) {
    super(message, "auth_error", false, requestId, statusCode);
    this.name = "AuthError";
  }
}

export class NotFoundError extends MeterFlowError {
  constructor(message: string, requestId?: string) {
    super(message, "not_found", false, requestId, 404);
    this.name = "NotFoundError";
  }
}

export class InsufficientCreditsError extends MeterFlowError {
  constructor(message: string, requestId?: string) {
    super(message, "insufficient_credits", false, requestId, 402);
    this.name = "InsufficientCreditsError";
  }
}

export class ConflictError extends MeterFlowError {
  constructor(message: string, requestId?: string) {
    super(message, "conflict", false, requestId, 409);
    this.name = "ConflictError";
  }
}

export class ValidationError extends MeterFlowError {
  constructor(message: string, requestId?: string) {
    super(message, "validation_error", false, requestId, 422);
    this.name = "ValidationError";
  }
}

export class RateLimitError extends MeterFlowError {
  readonly retryAfter: number | undefined;

  constructor(message: string, retryAfter?: number, requestId?: string) {
    super(message, "rate_limit", true, requestId, 429);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class ServerError extends MeterFlowError {
  constructor(message: string, requestId?: string, statusCode = 500) {
    super(message, "server_error", true, requestId, statusCode);
    this.name = "ServerError";
  }
}
