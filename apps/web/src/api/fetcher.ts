// orval mutator (httpClient: fetch): must return { data, status, headers }

export class RequestError extends Error {
  constructor(public status: number) {
    super(`Request failed (${status})`);
  }
}

// Browser-side auth header, attached transparently to every API call:
// the edit key — the write capability — from the URL path
// (/doc/<id>/<key>), with legacy ?key= links still honored.
function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const headers: Record<string, string> = {};
  const key =
    window.location.pathname.match(/^\/doc\/[^/]+\/([^/]+)/)?.[1] ??
    new URLSearchParams(window.location.search).get("key");
  if (key) headers["x-edit-key"] = key;
  return headers;
}

export const customFetch = async <T>(
  url: string,
  options: RequestInit = {}
): Promise<T> => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new RequestError(response.status);
  }

  const text = response.status === 204 ? "" : await response.text();
  const data = text ? JSON.parse(text) : undefined;

  return {
    data,
    status: response.status,
    headers: response.headers,
  } as T;
};
