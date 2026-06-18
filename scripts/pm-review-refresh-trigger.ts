import "dotenv/config";
import { POST } from "../src/app/api/cron/pm-review-refresh/route";

// Dispara a rota de refresh do PM Review SEM subir o next dev — invoca o handler
// direto com um Request portando o Bearer (token do .env) + service_role do .env.
// Mesmo efeito do cron (que faz net.http_post); útil pra smoke local (Fase 0).
//
//   NODE_OPTIONS='--conditions=react-server' pnpm tsx scripts/pm-review-refresh-trigger.ts

async function main() {
  const token = process.env.PM_REVIEW_REFRESH_AUTH_TOKEN;
  if (!token) {
    console.error("✖ PM_REVIEW_REFRESH_AUTH_TOKEN ausente no .env");
    process.exit(1);
  }
  const req = new Request("http://local/api/cron/pm-review-refresh", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  const res = await POST(req);
  console.log("HTTP", res.status);
  console.log(await res.text());
}

main().catch((e) => {
  console.error("✖", e);
  process.exit(1);
});
