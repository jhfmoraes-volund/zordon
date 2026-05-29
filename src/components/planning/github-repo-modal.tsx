"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, GitBranch, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Repo = {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
  updatedAt: string | null;
};

interface Props {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Repo já configurado (se houver) — abre o modal pré-selecionado pra trocar */
  current?: { owner: string; name: string; branch: string } | null;
  onSaved: () => void;
}

export function GitHubRepoModal({
  projectId,
  open,
  onOpenChange,
  current,
  onSaved,
}: Props) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [selectedFullName, setSelectedFullName] = useState<string>("");
  const [branch, setBranch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchRepos = useCallback(async () => {
    setLoadingRepos(true);
    setReposError(null);
    try {
      const r = await fetch("/api/integrations/composio/github/repos");
      const data = (await r.json()) as { repos?: Repo[]; error?: string };
      if (!r.ok) {
        setReposError(data.error ?? `Falha ao listar repos (${r.status})`);
        setRepos([]);
        return;
      }
      setRepos(data.repos ?? []);
    } catch (err) {
      setReposError((err as Error).message);
      setRepos([]);
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void fetchRepos();
    if (current) {
      setSelectedFullName(`${current.owner}/${current.name}`);
      setBranch(current.branch);
    } else {
      setSelectedFullName("");
      setBranch("");
    }
    setSearch("");
  }, [open, current, fetchRepos]);

  // Auto-fill da branch quando seleciona um repo
  useEffect(() => {
    if (!selectedFullName) return;
    const repo = repos.find((r) => r.fullName === selectedFullName);
    if (repo && (!branch || branch === current?.branch)) {
      setBranch(repo.defaultBranch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFullName, repos]);

  const filtered = useMemo(() => {
    if (!search.trim()) return repos;
    const q = search.toLowerCase();
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q),
    );
  }, [repos, search]);

  const handleSubmit = async () => {
    if (!selectedFullName || !branch) {
      toast.error("Selecione um repo e a branch");
      return;
    }
    const [owner, repo] = selectedFullName.split("/", 2);
    if (!owner || !repo) {
      toast.error("Formato do repo inválido");
      return;
    }

    setSubmitting(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/repo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo, branch }),
      });
      const data = (await r.json()) as {
        manifest?: { sizeBytes: number };
        warning?: string;
        error?: string;
      };
      if (!r.ok) {
        toast.error(data.error ?? `Falha (${r.status})`);
        return;
      }
      if (data.warning) {
        toast.warning(data.warning);
      } else if (data.manifest) {
        const kb = Math.round(data.manifest.sizeBytes / 1024);
        toast.success(`Repo configurado · manifest ${kb}KB gerado`);
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = (next: boolean) => {
    if (submitting) return;
    onOpenChange(next);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleClose}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            {current ? "Trocar repositório" : "Importar repositório GitHub"}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Vitória gera um manifest curado (AGENTS.md + estrutura + scripts) que
            fica no contexto dela todo turno — sem ingerir o repo inteiro.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar repo…"
              className="pl-9"
              disabled={loadingRepos}
            />
          </div>

          {/* Repo list */}
          <div className="border rounded-md max-h-80 overflow-y-auto">
            {loadingRepos ? (
              <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando repos…
              </div>
            ) : reposError ? (
              <div className="flex flex-col items-center justify-center gap-2 p-6 text-sm">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <p className="text-muted-foreground text-center">{reposError}</p>
                <Button size="sm" variant="outline" onClick={fetchRepos}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Tentar de novo
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground text-center">
                {repos.length === 0
                  ? "Nenhum repositório encontrado. Verifique se você autorizou os repos certos no Composio."
                  : "Nenhum repo bate com a busca."}
              </p>
            ) : (
              <ul className="divide-y">
                {filtered.map((repo) => {
                  const isSelected = selectedFullName === repo.fullName;
                  return (
                    <li key={repo.fullName}>
                      <button
                        type="button"
                        onClick={() => setSelectedFullName(repo.fullName)}
                        className={`w-full text-left px-3 py-2.5 hover:bg-muted/40 transition-colors ${
                          isSelected ? "bg-primary/10" : ""
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {repo.fullName}
                          </span>
                          {repo.private && (
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              private
                            </span>
                          )}
                        </div>
                        {repo.description && (
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                            {repo.description}
                          </p>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Branch */}
          {selectedFullName && (
            <div className="space-y-1.5">
              <label htmlFor="branch" className="text-sm font-medium">
                Branch
              </label>
              <Input
                id="branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">
                Default da Vitória — pode ser alterado depois.
              </p>
            </div>
          )}
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter>
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedFullName || !branch || submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Gerando manifest…
              </>
            ) : current ? (
              "Salvar"
            ) : (
              "Importar e gerar manifest"
            )}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
