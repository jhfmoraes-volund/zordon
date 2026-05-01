import { toast } from "sonner";

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: string | null,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function fetchOrThrow(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const body = await res.text().catch(() => null);
    throw new HttpError(res.status, body, `${res.status} ${res.statusText}`);
  }
  return res;
}

export type ErrorClass =
  | "forbidden"
  | "conflict"
  | "server"
  | "network"
  | "client"
  | "unknown";

export function classifyError(error: unknown): ErrorClass {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "network";
  }
  if (error instanceof TypeError) {
    return "network";
  }
  if (error instanceof HttpError) {
    if (error.status === 403) return "forbidden";
    if (error.status === 409) return "conflict";
    if (error.status >= 500) return "server";
    if (error.status >= 400) return "client";
  }
  return "unknown";
}

export function isRetryable(error: unknown): boolean {
  return classifyError(error) === "server";
}

export async function withServerRetry<T>(
  fn: () => Promise<T>,
  delayMs = 250,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isRetryable(e)) throw e;
    await new Promise((r) => setTimeout(r, delayMs));
    return fn();
  }
}

export type ErrorToastOptions = {
  label: string;
  onRetry?: () => void;
};

export function showErrorToast(error: unknown, options: ErrorToastOptions) {
  if (
    error instanceof DOMException &&
    error.name === "AbortError"
  ) {
    return;
  }

  const cls = classifyError(error);
  const message = describe(cls, options.label, error);

  toast.error(message, {
    action: options.onRetry
      ? { label: "Tentar de novo", onClick: options.onRetry }
      : undefined,
  });
}

function describe(cls: ErrorClass, label: string, error: unknown): string {
  switch (cls) {
    case "forbidden":
      return `${label}: você não tem permissão.`;
    case "conflict":
      return `${label}: outro usuário editou. Recarregue para ver.`;
    case "server":
      return `${label}: erro de servidor. Tente de novo.`;
    case "network":
      return `${label}: sem conexão. Mudança revertida.`;
    case "client": {
      const detail =
        error instanceof HttpError && error.body
          ? safeBody(error.body)
          : null;
      return detail ? `${label}: ${detail}` : `${label}: não foi possível salvar.`;
    }
    default:
      return `${label}: falha inesperada.`;
  }
}

function safeBody(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed.error === "string") return parsed.error;
    if (parsed && typeof parsed.message === "string") return parsed.message;
  } catch {
    if (body.length < 200) return body;
  }
  return null;
}
