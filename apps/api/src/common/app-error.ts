import { ErrorCodes, type ErrorCode } from '@caselind/contracts';

/** Domain error carrying a stable code and HTTP status; rendered by AllExceptionsFilter. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static unauthenticated(message = 'Authentication required'): AppError {
    return new AppError(401, ErrorCodes.unauthenticated, message);
  }

  static forbidden(message = 'You do not have permission to perform this action'): AppError {
    return new AppError(403, ErrorCodes.forbidden, message);
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError(404, ErrorCodes.notFound, message);
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError(409, ErrorCodes.conflict, message, details);
  }

  /** The feature is switched off for this user (feature flag: country, role or global kill switch). */
  static featureDisabled(message = 'This feature is not available'): AppError {
    return new AppError(403, ErrorCodes.featureDisabled, message);
  }
}
