/**
 * Sanitize messages shown in the UI.
 * Never expose URLs, hosts, API paths, query params, or stack-like details.
 */

const DEFAULT_SAFE_ERROR = "Unable to load data right now. Please try again.";

export function toSafeUserError(
  message: unknown,
  fallback: string = DEFAULT_SAFE_ERROR,
): string {
  const raw = String(message ?? "").trim();
  if (!raw) return fallback;

  const lower = raw.toLowerCase();

  if (
    /https?:\/\//i.test(raw) ||
    /www\./i.test(raw) ||
    /\/(factories|plots|api|field-officers|mittisense|users|farms|agrostats|analysis-timeline)\b/i.test(
      raw,
    ) ||
    /\.(railway\.app|ngrok[-.]|cloudflare|trycloudflare|localhost)\b/i.test(
      raw,
    ) ||
    /owner_id=|end_date=|factory_id=|plot_id=|farmer_id=/i.test(raw) ||
    /vite_|import\.meta|econnaborted|err_failed|access-control|cors/i.test(
      lower,
    ) ||
    /unexpected end of json|failed to execute ['"]json['"]|is not valid json|empty response|invalid data/i.test(
      lower,
    ) ||
    /request failed \(\d{3}\).* for \//i.test(raw) ||
    /status code \d{3}/i.test(lower) ||
    /network error/i.test(lower) ||
    /failed to fetch/i.test(lower)
  ) {
    return fallback;
  }

  // Drop trailing technical fragments while keeping short user text
  if (raw.length > 180) {
    return fallback;
  }

  return raw;
}

/** Prefer API detail when safe; otherwise generic fallback. */
export function toSafeApiError(
  err: unknown,
  fallback: string = DEFAULT_SAFE_ERROR,
): string {
  const axiosLike = err as {
    response?: { data?: { detail?: unknown; message?: unknown; error?: unknown } };
    message?: string;
  };
  const fromBody =
    axiosLike?.response?.data?.detail ??
    axiosLike?.response?.data?.message ??
    axiosLike?.response?.data?.error;
  if (fromBody != null && String(fromBody).trim()) {
    return toSafeUserError(fromBody, fallback);
  }
  if (err instanceof Error && err.message) {
    return toSafeUserError(err.message, fallback);
  }
  return toSafeUserError(err, fallback);
}
