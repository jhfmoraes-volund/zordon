"use client";

import { useState } from "react";
import { FileSpreadsheet, Upload, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

type ImportKind = "csv" | "gsheets";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (contextSourceId: string) => void;
  /** API URL base: POST /api/context-sources */
  apiUrl: string;
  projectId: string;
};

export function SpreadsheetModal({ open, onOpenChange, onImported, apiUrl, projectId }: Props) {
  const isMobile = useIsMobile();
  const [kind, setKind] = useState<ImportKind>("csv");
  const [file, setFile] = useState<File | null>(null);
  const [gsheetsUrl, setGsheetsUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setKind("csv");
    setFile(null);
    setGsheetsUrl("");
    setError(null);
  };

  const handleImport = async () => {
    setError(null);
    setImporting(true);

    try {
      if (kind === "csv") {
        if (!file) {
          setError("Selecione um arquivo CSV");
          return;
        }
        // base64 encode file
        const reader = new FileReader();
        reader.readAsDataURL(file);
        await new Promise((resolve, reject) => {
          reader.onload = resolve;
          reader.onerror = reject;
        });
        const base64 = (reader.result as string).split(",")[1];

        const res = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "spreadsheet_csv",
            projectId,
            title: file.name.replace(/\.csv$/i, ""),
            file: base64,
          }),
        });

        const json = await res.json();
        if (!res.ok) {
          setError(json.error || `HTTP ${res.status}`);
          return;
        }

        onImported(json.id);
        onOpenChange(false);
        reset();
      } else {
        // gsheets
        if (!gsheetsUrl.trim()) {
          setError("Insira a URL da planilha Google");
          return;
        }

        const res = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "spreadsheet_gsheets",
            projectId,
            title: "Planilha Google Sheets",
            externalUrl: gsheetsUrl.trim(),
          }),
        });

        const json = await res.json();
        if (!res.ok) {
          setError(json.error || `HTTP ${res.status}`);
          return;
        }

        onImported(json.id);
        onOpenChange(false);
        reset();
      }
    } catch (err) {
      setError((err as Error).message || "Erro de rede");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobile ? "max-h-[90vh] rounded-t-xl" : "w-full sm:max-w-lg",
        )}
      >
        {isMobile && (
          <div
            aria-hidden="true"
            className="mx-auto mt-2 mb-1 h-1.5 w-12 shrink-0 rounded-full bg-muted"
          />
        )}

        <div className="shrink-0 border-b px-4 py-4 sm:px-6 sm:py-5">
          <SheetTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Importar planilha
          </SheetTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            CSV local ou Google Sheets via URL
          </p>

          <div
            role="tablist"
            aria-label="Tipo de planilha"
            className="mt-4 inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1"
          >
            {(["csv", "gsheets"] as const).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={kind === k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                  kind === k
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {k === "csv" ? "CSV Upload" : "Google Sheets"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-4">
          {kind === "csv" ? (
            <Field name="csv-file">
              <Field.Label>Arquivo CSV</Field.Label>
              <Field.Control>
                <div className="relative">
                  <Input
                    id="csv-file"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="cursor-pointer"
                  />
                  {!file && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <Upload className="h-3.5 w-3.5" />
                      Selecione um arquivo .csv
                    </div>
                  )}
                </div>
              </Field.Control>
              <Field.Hint>
                Primeira linha = cabeçalhos. Snapshot único (não atualiza automaticamente).
              </Field.Hint>
            </Field>
          ) : (
            <Field name="gsheets-url" required>
              <Field.Label>URL da planilha Google</Field.Label>
              <Field.Control>
                <Input
                  id="gsheets-url"
                  type="url"
                  value={gsheetsUrl}
                  onChange={(e) => setGsheetsUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                />
              </Field.Control>
              <Field.Hint>
                Requer conexão OAuth Google Sheets configurada. Clique &ldquo;Refresh&rdquo; no sheet pra
                atualizar dados.
              </Field.Hint>
            </Field>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <div className="shrink-0 flex flex-col-reverse gap-2 border-t bg-popover px-4 py-3 sm:px-6 sm:flex-row sm:justify-end pb-safe">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            Cancelar
          </Button>
          <Button onClick={handleImport} disabled={importing || (kind === "csv" && !file) || (kind === "gsheets" && !gsheetsUrl.trim())}>
            {importing && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Importar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
