"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Library,
  Loader2,
  FileText,
  FileSpreadsheet,
  GitBranch,
  BookText,
  HardDrive,
  File as FileIcon,
  Check,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";

type PoolSource = {
  id: string;
  kind: string;
  title: string | null;
  createdAt: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** sourceIds já linkados ao ritual — saem da lista (idempotência visual). */
  linkedSourceIds: string[];
  /** Linka uma fonte ao ritual. Resolve quando o link persistiu. */
  onLink: (contextSourceId: string) => Promise<void>;
};

/** Rótulo PT + ícone por kind do ContextSource. */
function kindMeta(kind: string): { label: string; icon: React.ReactNode } {
  const icon = (node: React.ReactNode) => node;
  switch (kind) {
    case "transcript":
    case "meeting":
      return { label: "Reunião", icon: icon(<FileText className="h-3.5 w-3.5" />) };
    case "spreadsheet_csv":
    case "spreadsheet_gsheets":
      return { label: "Planilha", icon: icon(<FileSpreadsheet className="h-3.5 w-3.5" />) };
    case "github_repo":
    case "github_pr":
    case "github_issue":
      return { label: "GitHub", icon: icon(<GitBranch className="h-3.5 w-3.5" />) };
    case "notion":
      return { label: "Notion", icon: icon(<BookText className="h-3.5 w-3.5" />) };
    case "gdrive_file":
      return { label: "Drive", icon: icon(<HardDrive className="h-3.5 w-3.5" />) };
    case "document":
      return { label: "Documento", icon: icon(<FileIcon className="h-3.5 w-3.5" />) };
    default:
      return { label: kind, icon: icon(<FileIcon className="h-3.5 w-3.5" />) };
  }
}

/**
 * Picker universal do pool de contexto do projeto — lista TODO ContextSource
 * (qualquer kind) e linka o escolhido ao ritual. Resolve "o bloqueio é só a UI":
 * o schema (EntityLink) já aceita qualquer kind; aqui o PM seleciona da pool.
 */
export function SourcePoolModal({
  open,
  onOpenChange,
  projectId,
  linkedSourceIds,
  onLink,
}: Props) {
  const [sources, setSources] = useState<PoolSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [justLinked, setJustLinked] = useState<Set<string>>(new Set());

  const fetchPool = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/context-sources?projectId=${projectId}`);
      const json = (await r.json()) as { sources?: PoolSource[]; error?: string };
      if (!r.ok) {
        setError(json.error || `HTTP ${r.status}`);
        return;
      }
      setSources(json.sources ?? []);
    } catch (e) {
      setError((e as Error).message || "Erro de rede");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) {
      setJustLinked(new Set());
      fetchPool();
    }
  }, [open, fetchPool]);

  const linkedSet = new Set(linkedSourceIds);
  const available = sources.filter((s) => !linkedSet.has(s.id));

  const handleLink = async (id: string) => {
    setLinkingId(id);
    setError(null);
    try {
      await onLink(id);
      setJustLinked((prev) => new Set(prev).add(id));
    } catch (e) {
      setError((e as Error).message || "Falha ao linkar");
    } finally {
      setLinkingId(null);
    }
  };

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle className="flex items-center gap-2">
            <Library className="h-4 w-4" />
            Linkar do pool do projeto
          </ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            Qualquer insumo já importado no projeto (Drive, Notion, planilha,
            documento, GitHub) pode virar contexto deste ritual.
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando pool…
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : available.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nada disponível no pool — importe um insumo no projeto (aba Drive,
              Notion, planilha…) ou tudo já está linkado aqui.
            </p>
          ) : (
            <ul className="divide-y">
              {available.map((s) => {
                const meta = kindMeta(s.kind);
                const linked = justLinked.has(s.id);
                return (
                  <li key={s.id} className="flex items-center gap-3 py-3">
                    <span className="text-muted-foreground shrink-0">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{s.title ?? "Fonte sem título"}</p>
                      <Badge variant="outline" className="mt-0.5 text-[10px]">
                        {meta.label}
                      </Badge>
                    </div>
                    {linked ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 shrink-0">
                        <Check className="h-3.5 w-3.5" /> Linkado
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={linkingId === s.id}
                        onClick={() => handleLink(s.id)}
                      >
                        {linkingId === s.id && (
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        )}
                        Linkar
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ResponsiveSheetBody>

        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
