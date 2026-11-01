export type ErrorDetail = { path?: string; message: string; code?: string };

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ErrorDetail[];

  constructor(
    status: number,
    code: string,
    message: string,
    details: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static validation(details: ErrorDetail[], message = "Validation failed") {
    return new AppError(422, "VALIDATION_ERROR", message, details);
  }
  static unauthenticated(message = "Authentication required") {
    return new AppError(401, "UNAUTHENTICATED", message);
  }
  static forbidden(message = "You are not allowed to do this") {
    return new AppError(403, "FORBIDDEN", message);
  }
  static notFound(message = "Resource not found") {
    return new AppError(404, "NOT_FOUND", message);
  }
  static conflict(code = "CONFLICT", message = "Conflict") {
    return new AppError(409, code, message);
  }
  static invalidTransition(message = "This action is not allowed now") {
    return new AppError(409, "INVALID_TRANSITION", message);
  }
  static rateLimited(message = "Too many requests") {
    return new AppError(429, "RATE_LIMITED", message);
  }
  static internal(message = "Something went wrong") {
    return new AppError(500, "INTERNAL", message);
  }
}
