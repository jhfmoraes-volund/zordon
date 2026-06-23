"use client";

import { useState } from "react";
import { GitBranch, Loader2, CheckCircle2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (contextSourceId: string) => void;
  /** API URL base: POST /api/context-sources */
  apiUrl: string;
  projectId: string;
};

type DetectedKind = "github_repo" | "github_pr" | "github_issue" | null;

function detectKind(url: string): DetectedKind {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)(?:\/pull\/(\d+))?(?:\/issues\/(\d+))?/i);
  if (!match) return null;
  if (match[3]) return "github_pr";
  if (match[4]) return "github_issue";
  return "github_repo";
}

const KIND_LABEL: Record<NonNullable<DetectedKind>, string> = {
  github_repo: "Repositório",
  github_pr: "Pull Request",
  github_issue: "Issue",
};

export function GitHubSourceModal({ open, onOpenChange, onImported, apiUrl, projectId }: Props) {
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectedKind = url.trim() ? detectKind(url.trim()) : null;

  const reset = () => {
    setUrl("");
    setError(null);
  };

  const handleImport = async () => {
    setError(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Insira uma URL do GitHub");
      return;
    }

    const kind = detectKind(trimmed);
    if (!kind) {
      setError("URL inválida. Use o formato: github.com/owner/repo[/pull/N ou /issues/N]");
      return;
    }

    setImporting(true);
    try {
      const m = trimmed.match(
        /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(?:pull|issues)\/(\d+))?\/?$/i,
      );
      const title = m
        ? `${m[1]}/${m[2]}${m[3] ? `#${m[3]}` : ""}`
        : trimmed;

      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          projectId,
          title,
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
            <GitBranch className="h-4 w-4" />
            Importar do GitHub
          </ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            Repositório, Pull Request ou Issue como contexto
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody className="space-y-4">
          <Field name="github-url" required>
            <Field.Label>URL do GitHub</Field.Label>
            <Field.Control>
              <Input
                id="github-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
              />
            </Field.Control>
            <Field.Hint>
              Cole a URL completa: repositório (README), pull request ou issue.
            </Field.Hint>
          </Field>

          {detectedKind && (
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="font-medium">Tipo detectado:</span>
                <Badge variant="secondary">{KIND_LABEL[detectedKind]}</Badge>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {detectedKind === "github_repo" &&
                  "Conteúdo do README.md será importado como contexto."}
                {detectedKind === "github_pr" &&
                  "Título, descrição, comentários e diffs serão importados."}
                {detectedKind === "github_issue" &&
                  "Título, descrição e comentários serão importados."}
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
