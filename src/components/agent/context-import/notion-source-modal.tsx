"use client";

import { useState } from "react";
import { BookText, Loader2, CheckCircle2 } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetDescription,
  ResponsiveSheetBody,
  ResponsiveSheetFooter,
} from "@/components/ui/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (contextSourceId: string) => void;
  /** API URL base: POST /api/context-sources */
  apiUrl: string;
  projectId: string;
};

/** Detecta o ID de 32 hex no fim do slug do Notion (com ou sem hífens). */
function detectNotionId(url: string): boolean {
  return /[0-9a-f]{32}/i.test(url) ||
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(url);
}

export function NotionSourceModal({ open, onOpenChange, onImported, apiUrl, projectId }: Props) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detected = url.trim() ? detectNotionId(url.trim()) : false;

  const reset = () => {
    setUrl("");
    setTitle("");
    setError(null);
  };

  const handleImport = async () => {
    setError(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Insira a URL de uma página ou base do Notion");
      return;
    }
    if (!detectNotionId(trimmed)) {
      setError("URL inválida. Cole o link completo da página/base do Notion.");
      return;
    }

    setImporting(true);
    try {
      const fallbackTitle =
        title.trim() ||
        decodeURIComponent(trimmed.split("/").pop() ?? "")
          .replace(/-[0-9a-f]{32}.*$/i, "")
          .replace(/-/g, " ")
          .trim() ||
        "Página do Notion";

      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "notion",
          projectId,
          title: fallbackTitle,
          externalUrl: trimmed,
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
    } catch (err) {
      setError((err as Error).message || "Erro de rede");
    } finally {
      setImporting(false);
    }
  };

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle className="flex items-center gap-2">
            <BookText className="h-4 w-4" />
            Importar do Notion
          </ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            Página ou base do Notion como contexto
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody className="space-y-4">
          <Field name="notion-url" required>
            <Field.Label>URL do Notion</Field.Label>
            <Field.Control>
              <Input
                id="notion-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.notion.so/workspace/Pagina-abc123..."
              />
            </Field.Control>
            <Field.Hint>
              Cole o link da página/base. A integração precisa ter acesso a ela no
              Notion (compartilhe a página com a conexão).
            </Field.Hint>
          </Field>

          <Field name="notion-title">
            <Field.Label>Título (opcional)</Field.Label>
            <Field.Control>
              <Input
                id="notion-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Deixe vazio pra derivar da URL"
              />
            </Field.Control>
          </Field>

          {detected && (
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="font-medium">ID do Notion detectado na URL</span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                O conteúdo será importado como contexto (página inteira, incluindo
                subpáginas, toggles e bases renderizadas como tabela).
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </ResponsiveSheetBody>

        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            Cancelar
          </Button>
          <Button onClick={handleImport} disabled={importing || !url.trim()}>
            {importing && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Importar
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
