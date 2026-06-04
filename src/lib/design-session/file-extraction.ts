// Text extraction for user-uploaded session files. Each handler returns the
// extracted text (or "" if the format yields nothing readable). Caller maps
// "" + unsupported mime to extractionStatus='unsupported' on the row.

export type ExtractionResult = {
  text: string;
  status: "success" | "unsupported" | "failed";
};

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — matches Storage bucket cap

export function isOverSizeLimit(size: number): boolean {
  return size > MAX_BYTES;
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<ExtractionResult> {
  try {
    const lower = filename.toLowerCase();

    if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
      // pdf-parse v2.x exporta classe PDFParse (mudou da função default da v1).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PDFParse } = require("pdf-parse") as {
        PDFParse: new (opts: { data: Buffer | Uint8Array }) => {
          getText: () => Promise<{ text: string }>;
        };
      };
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      return { text: result.text ?? "", status: "success" };
    }

    if (
      mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      lower.endsWith(".docx")
    ) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return { text: result.value ?? "", status: "success" };
    }

    if (
      mimeType === "text/html" ||
      lower.endsWith(".html") ||
      lower.endsWith(".htm")
    ) {
      const { parse } = await import("node-html-parser");
      const root = parse(buffer.toString("utf-8"));
      root
        .querySelectorAll("script, style, noscript")
        .forEach((el) => el.remove());
      const text = root.text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      return { text, status: "success" };
    }

    if (mimeType === "text/csv" || lower.endsWith(".csv")) {
      const { parse } = await import("csv-parse/sync");
      const rows = parse(buffer, {
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
      }) as string[][];
      return { text: rowsToMarkdownTable(rows), status: "success" };
    }

    if (
      mimeType ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimeType === "application/vnd.ms-excel" ||
      lower.endsWith(".xlsx") ||
      lower.endsWith(".xls")
    ) {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      // ExcelJS expects an ArrayBuffer-like. Slice to a fresh ArrayBuffer to
      // satisfy the loose typing in @types/node 22 (Buffer<ArrayBufferLike>).
      const ab = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      );
      await wb.xlsx.load(ab as ArrayBuffer);
      const parts: string[] = [];
      wb.eachSheet((sheet) => {
        const rows: string[][] = [];
        sheet.eachRow((row) => {
          const cells: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            const v = cell.value;
            cells.push(v == null ? "" : String(typeof v === "object" && "text" in v ? v.text : v));
          });
          rows.push(cells);
        });
        if (rows.length > 0) {
          parts.push(`### ${sheet.name}\n\n${rowsToMarkdownTable(rows)}`);
        }
      });
      return { text: parts.join("\n\n"), status: "success" };
    }

    if (
      mimeType.startsWith("text/") ||
      lower.endsWith(".txt") ||
      lower.endsWith(".md") ||
      lower.endsWith(".json") ||
      lower.endsWith(".yaml") ||
      lower.endsWith(".yml")
    ) {
      return { text: buffer.toString("utf-8"), status: "success" };
    }

    return { text: "", status: "unsupported" };
  } catch (e) {
    console.error("[file-extraction] failed:", filename, e);
    return { text: "", status: "failed" };
  }
}

function rowsToMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const header = rows[0];
  const body = rows.slice(1);
  const headerLine = `| ${header.map(escapeCell).join(" | ")} |`;
  const sepLine = `| ${header.map(() => "---").join(" | ")} |`;
  const bodyLines = body.map((r) => `| ${r.map(escapeCell).join(" | ")} |`);
  return [headerLine, sepLine, ...bodyLines].join("\n");
}

function escapeCell(cell: string): string {
  return cell.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}
