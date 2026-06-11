import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pdf-parse (v2/pdfjs) quebra quando bundleado pro server (exige DOMMatrix/
  // canvas no build errado). Externalizado, roda como require puro do Node —
  // mesmo comportamento de scripts tsx. Usado pela extração de texto de
  // uploads e pelo adapter do Drive (refresh diário do cron).
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
