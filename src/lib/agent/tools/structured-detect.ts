// Detecção de "estruturado" — pura, SEM dependência de DuckDB. Vive separada
// de structured-source.ts pra que o caminho de leitura (read_context_source /
// D10) possa rotear sem carregar o binding nativo do DuckDB.
export type StructuredFormat = "json" | "csv";

/**
 * Sniff barato: a fonte é consultável como tabela (JSON/CSV)? Não é por enum de
 * kind (runbook D4) — `spreadsheet_csv` é CSV por definição; qualquer outra
 * fonte vira JSON se o fullText parseia como JSON. Caso contrário (prosa,
 * vazio, malformado) → null, e o caller cai no caminho de texto.
 */
export function detectStructuredFormat(source: {
  kind?: string | null;
  fullText?: string | null;
}): StructuredFormat | null {
  const text = source.fullText ?? "";
  if (!text.trim()) return null;
  if (source.kind === "spreadsheet_csv") return "csv";
  const head = text.trimStart()[0];
  if (head === "{" || head === "[") {
    try {
      JSON.parse(text);
      return "json";
    } catch {
      return null;
    }
  }
  return null;
}
