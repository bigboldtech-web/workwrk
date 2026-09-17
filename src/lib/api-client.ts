// The spec names this path (spec-shell.md section 1.7); the implementation
// lives in ./api-fetch.ts. The previous contract here (throw an ApiError and
// hard-redirect to /login on 401, dropping the callback URL) had no importers
// and is gone: a 401 now dispatches `workwrk:session-expired` and the shell's
// SessionExpiredDialog takes it from there.

export {
  apiFetch,
  apiFetchWithRetry,
  parseErrorBody,
  defaultErrorFor,
  shouldRetry,
  isSafeMethod,
  backoffDelayMs,
  SESSION_EXPIRED_ERROR,
  OFFLINE_ERROR,
} from "./api-fetch";
export type { ApiResult, ApiOk, ApiFail, ApiFetchInit, RetryOptions, RetryResult } from "./api-fetch";
