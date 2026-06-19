// structured-query — engine de querying sobre insumos estruturados (DuckDB
// in-process). SEM dependência de DB nem de "ai": recebe o fullText direto,
// materializa num arquivo efêmero e roda SQL read-only. Vive separado de
// structured-source.ts (as tool factories) pra ser testável isolado — o
// teste passa um fixture string sem subir Supabase/Next.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import type { StructuredFormat } from "./structured-detect";

// ─── Orçamento (guardrails do runbook §9) ───────────────────────────────────
const ROW_CAP = 200; // linhas máximas por query result
const CHAR_CAP = 30_000; // chars máximos do payload serializado
const MEMORY_LIMIT = "512MB"; // teto de RAM do DuckDB (cappável; derrama p/ disco)
const QUERY_TIMEOUT_MS = 15_000; // soft-timeout (não cancela a query, libera o await)
const STRUCTURED_DIR = join(tmpdir(), "zordon-structured");

// ─── DuckDB :memory: singleton (custo fixo de init pago 1×) ──────────────────
let _instance: Promise<DuckDBInstance> | null = null;
function instance(): Promise<DuckDBInstance> {
  if (!_instance) _instance = DuckDBInstance.create(":memory:");
  return _instance;
}

async function connect(): Promise<DuckDBConnection> {
  const conn = await (await instance()).connect();
  await conn.run(`SET memory_limit='${MEMORY_LIMIT}'`);
  return conn;
}

/** Materializa o fullText em arquivo efêmero (lazy, idempotente por sourceId). */
function materialize(
  sourceId: string,
  format: StructuredFormat,
  fullText: string,
): string {
  mkdirSync(STRUCTURED_DIR, { recursive: true });
  const path = join(STRUCTURED_DIR, `${sourceId}.${format}`);
  if (!existsSync(path)) writeFileSync(path, fullText);
  return path;
}

function reader(format: StructuredFormat, path: string): string {
  const p = path.replace(/'/g, "''"); // escape defensivo p/ a string SQL
  return format === "csv" ? `read_csv_auto('${p}')` : `read_json_auto('${p}')`;
}

/** DuckDB devolve BIGINT como BigInt do JS — JSON.stringify quebra sem isto. */
const bigintReplacer = (_k: string, v: unknown) =>
  typeof v === "bigint" ? Number(v) : v;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`query timeout (${ms}ms)`)), ms),
    ),
  ]);
}

// Read-only guard: bloqueia tudo que muta estado ou toca FS/extensões. A
// materialização é efêmera e read-only por contrato (D6) — só SELECT entra.
const FORBIDDEN_SQL =
  /\b(insert|update|delete|drop|create|alter|attach|detach|copy|pragma|install|load|export|import|call|set|truncate|vacuum|begin|commit|rollback|grant|revoke)\b/i;

export type StructuredColumn = { name: string; type: string };

export type StructuredDescribeResult = {
  ok: true;
  format: StructuredFormat;
  table: "src";
  rowCount: number;
  columns: StructuredColumn[];
  hint: string;
};

/** Shape mecânico: colunas + tipos + contagem. Nunca inlina o blob (§6). */
export async function describeStructured(
  sourceId: string,
  format: StructuredFormat,
  fullText: string,
): Promise<StructuredDescribeResult> {
  const path = materialize(sourceId, format, fullText);
  const conn = await connect();
  const rd = reader(format, path);
  const desc = await conn.runAndReadAll(`DESCRIBE SELECT * FROM ${rd}`);
  const columns: StructuredColumn[] = desc
    .getRows()
    .map((r) => ({ name: String(r[0]), type: String(r[1]) }));
  const countRes = await conn.runAndReadAll(`SELECT COUNT(*) AS n FROM ${rd}`);
  const rowCount = Number(countRes.getRows()[0]?.[0] ?? 0);
  return {
    ok: true,
    format,
    table: "src",
    rowCount,
    columns,
    hint:
      "Use query_structured_source com SQL referenciando a tabela `src`. " +
      "Ex: SELECT contributor, COUNT(*) FROM src GROUP BY contributor. " +
      "Para arrays/structs aninhados use UNNEST(coluna). Ancore decisões em " +
      "agregados (COUNT/SUM/GROUP BY), não em leitura de linhas cruas.",
  };
}

export type StructuredQueryResult =
  | {
      ok: true;
      columns: string[];
      rowsReturned: number;
      rowCapped: boolean;
      charTruncated: boolean;
      rows: Record<string, unknown>[];
    }
  | {
      ok: false;
      error: string;
      table: "src";
      columns: StructuredColumn[];
      hint: string;
    };

/** SQL read-only sobre a fonte (exposta como `src`), orçado + self-correcting. */
export async function queryStructured(
  sourceId: string,
  format: StructuredFormat,
  fullText: string,
  sql: string,
): Promise<StructuredQueryResult> {
  if (FORBIDDEN_SQL.test(sql)) {
    return {
      ok: false,
      error:
        "Apenas SELECT read-only é permitido (sem INSERT/UPDATE/DDL/PRAGMA/SET/etc).",
      table: "src",
      columns: [],
      hint: "Reescreva como um único SELECT sobre a tabela `src`.",
    };
  }

  const path = materialize(sourceId, format, fullText);
  const conn = await connect();
  const rd = reader(format, path);
  await conn.run(`CREATE OR REPLACE TEMP VIEW src AS SELECT * FROM ${rd}`);

  // Cap por subquery: pega ROW_CAP+1 pra detectar "tem mais". Funciona com o
  // LIMIT/OFFSET próprio do agente (paginação) — o cap externo só limita o topo.
  const inner = sql.trim().replace(/;+\s*$/, "");
  const capped = `SELECT * FROM (${inner}) AS _q LIMIT ${ROW_CAP + 1}`;

  try {
    const res = await withTimeout(conn.runAndReadAll(capped), QUERY_TIMEOUT_MS);
    const columns = res.columnNames();
    const allRows = res.getRowObjects() as Record<string, unknown>[];
    const rowCapped = allRows.length > ROW_CAP;
    let rows = rowCapped ? allRows.slice(0, ROW_CAP) : allRows;

    // Char cap: encolhe o número de linhas até o payload caber.
    let charTruncated = false;
    if (JSON.stringify(rows, bigintReplacer).length > CHAR_CAP) {
      let lo = rows.length;
      while (
        lo > 0 &&
        JSON.stringify(rows.slice(0, lo), bigintReplacer).length > CHAR_CAP
      ) {
        lo--;
      }
      rows = rows.slice(0, lo);
      charTruncated = true;
    }

    // Round-trip pelo replacer normaliza BigInt→Number no payload retornado.
    return {
      ok: true,
      columns,
      rowsReturned: rows.length,
      rowCapped,
      charTruncated,
      rows: JSON.parse(JSON.stringify(rows, bigintReplacer)),
    };
  } catch (err) {
    // Self-correcting (D7): devolve o schema pra Vitoria reescrever o SQL.
    const schema = await describeStructured(sourceId, format, fullText).catch(
      () => null,
    );
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      table: "src",
      columns: schema?.columns ?? [],
      hint:
        "O SQL falhou. Reescreva referenciando a tabela `src` e as colunas acima. " +
        "Lembre: só SELECT, a fonte é `src`.",
    };
  }
}
