export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Antwort des Servers, z.B. mit «code» für erwartete Konflikte */
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
  }

  get code(): string | undefined {
    return typeof this.data?.code === 'string' ? this.data.code : undefined;
  }
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

let onUnauthorized: (() => void) | null = null;

/** Wird aufgerufen, wenn die Sitzung abgelaufen ist. */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(method: string, path: string, body?: Body): Promise<T> {
  const headers: Record<string, string> = { 'X-Patchwork': '1' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Der Server ist nicht erreichbar.');
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
    const serverMessage =
      data && typeof data === 'object' && 'message' in data && typeof data.message === 'string' ? data.message : '';
    const message = serverMessage || (res.status === 413 ? 'Die Datei ist zu gross.' : `Fehler ${res.status}`);
    throw new ApiError(res.status, message, data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: Body) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: Body) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: Body) => request<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string, body?: Body) => request<T>('DELETE', path, body),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unbekannter Fehler';
}
