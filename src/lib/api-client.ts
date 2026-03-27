/** Client-side fetch wrapper with consistent error handling */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T = any>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(url, options);

  if (res.status === 401) {
    window.location.href = "/login";
    throw new ApiError("Unauthorized", 401);
  }

  if (!res.ok) {
    let msg = "Something went wrong";
    try {
      const body = await res.json();
      msg = body.error || body.message || msg;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(msg, res.status);
  }

  return res.json();
}
