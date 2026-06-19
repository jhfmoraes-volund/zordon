import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pdf-parse (v2/pdfjs) quebra quando bundleado pro server (exige DOMMatrix/
  // canvas no build errado). Externalizado, roda como require puro do Node —
  // mesmo comportamento de scripts tsx. Usado pela extração de texto de
  // uploads e pelo adapter do Drive (refresh diário do cron).
  //
  // @duckdb/node-api é binding NATIVO (.node) — o bundler do Next quebra ao
  // tentar empacotar. Externalizado, vira require puro do Node (igual ao tsx
  // do smoke). Usado pelas structured tools (describe/query_structured_source)
  // no tool router; sem isto, importar a tool derruba o módulo inteiro do route.
  serverExternalPackages: ["pdf-parse", "@duckdb/node-api"],
};

export default nextConfig;
