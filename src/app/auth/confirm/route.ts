import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Magic link / invite / recovery callback (OTP / PKCE flow).
 *
 * Supabase manda o user pra cá com `?token_hash=...&type=...` quando o projeto
 * usa fluxo OTP. Verificamos o token, o que seta cookie de sessão via server
 * client, e redirecionamos pro `next`.
 *
 * Quando o projeto usa fluxo IMPLICIT, o token vem no fragmento (`#access_token=`),
 * que não é acessível server-side. Nesse caso a request cai direto numa URL
 * sem `token_hash` na query — devolvemos uma página client-side que extrai o
 * token do hash, hidrata a sessão via supabase-js, e segue pro `next`.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  // OTP path: token na query.
  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });

    if (error) {
      console.error("[auth/confirm] verifyOtp error:", error.message);
      return NextResponse.redirect(
        new URL("/login?error=verify_failed", request.url),
      );
    }

    return NextResponse.redirect(new URL(next, request.url));
  }

  // Implicit path: token no fragmento (#). Servimos HTML com JS que lê o hash,
  // chama supabase.auth.setSession() — o client SDK persiste o cookie via SSR —
  // e finalmente navega pro destino real.
  const html = `<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8" />
  <title>Validando acesso…</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; background: #0a0a0a; color: #e5e5e5; display: grid; place-items: center; min-height: 100vh; margin: 0; }
    .box { text-align: center; }
    .err { color: #f87171; margin-top: 8px; }
    a { color: #60a5fa; }
  </style>
</head>
<body>
  <div class="box">
    <p>Validando acesso…</p>
    <p id="err" class="err"></p>
  </div>
  <script type="module">
    import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
    const supabase = createClient(
      ${JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")},
      ${JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "")}
    );

    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : "";
    const params = new URLSearchParams(hash);
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    const type = params.get("type");
    const errParam = params.get("error_description") ?? params.get("error");
    const errEl = document.getElementById("err");

    if (errParam) {
      errEl.textContent = decodeURIComponent(errParam);
      setTimeout(() => { window.location.href = "/login?error=invalid_link"; }, 1500);
    } else if (!access_token || !refresh_token) {
      errEl.textContent = "Link inválido. Pede um novo acesso ao admin.";
      setTimeout(() => { window.location.href = "/login?error=invalid_link"; }, 1500);
    } else {
      // setSession() faz uma chamada de validação e dispara o evento que o
      // listener do SSR (createBrowserClient) usa pra escrever os cookies de
      // sessão — o redirect que segue cai logado.
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error) {
        errEl.textContent = error.message;
        setTimeout(() => { window.location.href = "/login?error=verify_failed"; }, 1500);
      } else {
        // Recovery → set-password. Magiclink / signup → next ou raiz.
        const nextUrl = ${JSON.stringify(next)};
        const dest = type === "recovery"
          ? "/auth/set-password?next=" + encodeURIComponent(nextUrl)
          : nextUrl;
        window.location.replace(dest);
      }
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
