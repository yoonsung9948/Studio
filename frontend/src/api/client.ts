import { readAppConfiguration } from "../config";
import { apiSession } from "./session";
export const API_PREFIX = "/api/v1";
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
  get sessionExpired() {
    return this.status === 401;
  }
}
export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  rawBody?: Blob;
  headers?: HeadersInit;
  signal?: AbortSignal;
  timeoutMs?: number;
}
/** Clerk bearer tokens are resolved per request. Mutations are never retried here. */
export async function requestJSON<T>(
  path: string,
  parse: (value: unknown) => T,
  options: RequestOptions = {},
): Promise<T> {
  if (readAppConfiguration().authBypass)
    throw new ApiError(
      403,
      "development_bypass",
      "Backend access is disabled while login bypass is enabled. Disable VITE_AUTH_BYPASS and sign in to use the API.",
    );
  const session = apiSession();
  const assertSession = () => {
    if (apiSession() !== session)
      throw new ApiError(
        401,
        "session_changed",
        "Your session changed. Sign in again.",
      );
  };
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const abortSession = () =>
    controller.abort(new DOMException("Session changed", "AbortError"));
  session?.signal.addEventListener("abort", abortSession, { once: true });
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 15000,
  );
  try {
    const headers = new Headers(options.headers);
    if (session) {
      let releaseAbort = () => {};
      try {
        const token = await Promise.race([
          session.getToken(),
          new Promise<never>((_, reject) => {
            const fail = () =>
              reject(
                options.signal?.aborted
                  ? (options.signal.reason ??
                      new DOMException("Aborted", "AbortError"))
                  : new ApiError(
                      0,
                      "request_timeout",
                      "The session request timed out. Retry.",
                    ),
              );
            if (controller.signal.aborted) fail();
            else
              controller.signal.addEventListener("abort", fail, { once: true });
            releaseAbort = () =>
              controller.signal.removeEventListener("abort", fail);
          }),
        ]);
        assertSession();
        if (!token)
          throw new ApiError(401, "unauthenticated", "Sign in to continue.");
        headers.set("Authorization", `Bearer ${token}`);
      } catch (error) {
        assertSession();
        if (error instanceof ApiError || options.signal?.aborted) throw error;
        throw new ApiError(
          0,
          "network_error",
          "Could not refresh your session. Check the connection and retry.",
        );
      } finally {
        releaseAbort();
      }
    }
    if (controller.signal.aborted)
      throw options.signal?.reason ?? new DOMException("Aborted", "AbortError");
    headers.set("Accept", "application/json");
    if (options.body !== undefined)
      headers.set("Content-Type", "application/json");
    if (options.rawBody) headers.set("Content-Type", options.rawBody.type);
    let response: Response;
    try {
      response = await fetch(`${API_PREFIX}${path}`, {
        method: options.method ?? "GET",
        headers,
        body:
          options.rawBody ??
          (options.body === undefined
            ? undefined
            : JSON.stringify(options.body)),
        credentials: "include",
        signal: controller.signal,
      });
    } catch (error) {
      assertSession();
      if (options.signal?.aborted) throw error;
      throw new ApiError(
        0,
        controller.signal.aborted ? "request_timeout" : "network_error",
        controller.signal.aborted
          ? "The request timed out. Check the connection and retry."
          : "Could not reach the API. Check that the Go server is running on port 8080.",
      );
    }
    if (response.status === 204) {
      assertSession();
      return parse(null);
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      assertSession();
      if (options.signal?.aborted) throw error;
      if (controller.signal.aborted)
        throw new ApiError(
          0,
          "request_timeout",
          "The request timed out. Check the connection and retry.",
        );
      if (error instanceof TypeError)
        throw new ApiError(
          0,
          "network_error",
          "The connection was interrupted while reading the response.",
        );
      throw new ApiError(
        response.status,
        "invalid_response",
        "The API did not return JSON. Check the server and /api proxy.",
      );
    }
    assertSession();
    if (!response.ok) {
      const error = (
        value as { error?: { code?: unknown; message?: unknown } } | null
      )?.error;
      throw new ApiError(
        response.status,
        typeof error?.code === "string" ? error.code : "http_error",
        typeof error?.message === "string"
          ? error.message
          : response.status === 401
            ? "Your session has expired. Sign in again."
            : `Request failed (${response.status}).`,
      );
    }
    try {
      return parse(value);
    } catch {
      throw new ApiError(
        response.status,
        "invalid_response",
        "The API returned an unsupported response. Check the server version.",
      );
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    session?.signal.removeEventListener("abort", abortSession);
  }
}
