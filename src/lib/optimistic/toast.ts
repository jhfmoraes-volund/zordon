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

/**
 * Estouro do `timeoutMs` do fetchOrThrow. Distinto de um AbortError cru de
 * propósito: showErrorToast ENGOLE AbortError (mutation superada por outra mais
 * nova), mas um timeout É um erro que o usuário precisa ver — senão o request
 * pendura, o botão reseta calado e ninguém sabe se aplicou.
 */
export class TimeoutError extends Error {
  constructor(message = "tempo esgotado") {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * @param opts.timeoutMs aborta o fetch após N ms e lança `TimeoutError`. Ignorado
 *   se `init.signal` já foi passado (o caller controla o abort). Use pra operações
 *   longas (ex: aplicar plano inteiro) que não podem pendurar a UI pra sempre.
 */
export async function fetchOrThrow(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: { timeoutMs?: number },
): Promise<Response> {
  const timeoutMs = opts?.timeoutMs;
  const useTimeout = !!timeoutMs && !init?.signal;
  const controller = useTimeout ? new AbortController() : undefined;
  let timedOut = false;
  const timer = useTimeout
    ? setTimeout(() => {
        timedOut = true;
        controller!.abort();
      }, timeoutMs)
    : undefined;

  try {
    const res = await fetch(input, controller ? { ...init, signal: controller.signal } : init);
    if (!res.ok) {
      const body = await res.text().catch(() => null);
      throw new HttpError(res.status, body, `${res.status} ${res.statusText}`);
    }
    return res;
  } catch (e) {
    if (timedOut) throw new TimeoutError(`tempo esgotado após ${Math.round(timeoutMs! / 1000)}s`);
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type ErrorClass =
  | "forbidden"
  | "conflict"
  | "server"
  | "network"
  | "timeout"
  | "client"
  | "unknown";

export function classifyError(error: unknown): ErrorClass {
  if (error instanceof TimeoutError) {
    return "timeout";
  }
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
  // PostgrestError-like (Supabase): has a string `code`.
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { code: unknown }).code ?? "");
    if (code === "42501" || code === "PGRST301") return "forbidden";
    if (code === "23505") return "conflict";
    if (code.startsWith("23")) return "client"; // integrity violations
    if (code === "P0001") return "client"; // RAISE EXCEPTION sem código próprio
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
    case "timeout":
      return `${label}: demorou demais. Recarregue e confira se foi aplicado.`;
    case "client": {
      const detail =
        error instanceof HttpError && error.body
          ? safeBody(error.body)
          : extractMessage(error);
      return detail ? `${label}: ${detail}` : `${label}: não foi possível salvar.`;
    }
    default: {
      const detail = extractMessage(error);
      return detail ? `${label}: ${detail}` : `${label}: falha inesperada.`;
    }
  }
}

function extractMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const obj = error as { message?: unknown };
  if (typeof obj.message !== "string") return null;
  const msg = obj.message.trim();
  if (!msg || msg.length > 240) return null;
  return msg;
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
