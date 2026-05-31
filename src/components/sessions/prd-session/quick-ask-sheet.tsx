"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Field, FormBody } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { showErrorToast } from "@/lib/optimistic/toast";

type JobStatus = "queued" | "running" | "done" | "failed";

type GeneratedPrd = {
  id: string;
  title: string;
  problem: string;
  goal: string;
  acceptanceCriteria: string[];
  status: string;
};

type JobResponse = {
  jobId: string;
  sessionId: string;
  status: JobStatus;
  prdCount: number;
  error?: string;
  prds?: GeneratedPrd[] | null;
};

export function PrdQuickAskSheet({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [brief, setBrief] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [prds, setPrds] = useState<GeneratedPrd[]>([]);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poll job status when jobId is set
  useEffect(() => {
    if (!jobId) return;

    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/sessions/prd/quick-ask/jobs/${jobId}`);
        if (!res.ok) {
          if (active) setError("Erro ao buscar status do job");
          return;
        }

        const data = (await res.json()) as JobResponse;
        if (!active) return;

        setJobStatus(data.status);
        setSessionId(data.sessionId);

        if (data.status === "done" && data.prds) {
          setPrds(data.prds);
        } else if (data.status === "failed") {
          setError(data.error ?? "Erro desconhecido ao gerar PRDs");
        }
      } catch (err) {
        if (active) {
          console.error("[PrdQuickAskSheet] Poll error:", err);
        }
      }
    };

    poll();
    const interval = setInterval(poll, 2000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [jobId]);

  const handleSubmit = async () => {
    if (!brief.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/sessions/prd/quick-ask/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          brief: brief.trim(),
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Falha ao iniciar geração");
      }

      const result = await res.json();
      setJobId(result.jobId);
      setSessionId(result.sessionId);
      setJobStatus("queued");
    } catch (err) {
      showErrorToast(err, { label: "Quick-ask PRD" });
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproveAll = async () => {
    if (prds.length === 0) return;

    setApproving(true);
    try {
      const res = await fetch("/api/sessions/prd/approve", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prdIds: prds.map((p) => p.id),
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Falha ao aprovar PRDs");
      }

      // Navigate to session page
      if (sessionId) {
        onOpenChange(false);
        router.push(`/projects/${projectId}/sessions/${sessionId}`);
      }
    } catch (err) {
      showErrorToast(err, { label: "Aprovar PRDs" });
    } finally {
      setApproving(false);
    }
  };

  const handleApproveOne = async (prdId: string) => {
    setApproving(true);
    try {
      const res = await fetch("/api/sessions/prd/approve", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prdIds: [prdId],
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Falha ao aprovar PRD");
      }

      // Update local state
      setPrds((cur) =>
        cur.map((p) => (p.id === prdId ? { ...p, status: "ready" } : p))
      );
    } catch (err) {
      showErrorToast(err, { label: "Aprovar PRD" });
    } finally {
      setApproving(false);
    }
  };

  const handleReset = () => {
    setBrief("");
    setJobId(null);
    setSessionId(null);
    setJobStatus(null);
    setPrds([]);
    setError(null);
  };

  const isGenerating = jobStatus === "queued" || jobStatus === "running";
  const isDone = jobStatus === "done";
  const hasFailed = jobStatus === "failed" || error !== null;

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="lg">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            PRD Quick-Ask com Vitor
          </ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            Descreva sua ideia em 2-3 frases e Vitor gerará PRDs estruturados em segundos.
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody>
          <FormBody density="comfortable">
            {!jobId && (
              <>
                <Field name="brief" required>
                  <Field.Label>Descreva sua ideia</Field.Label>
                  <Field.Control>
                    <Textarea
                      value={brief}
                      onChange={(e) => setBrief(e.target.value)}
                      placeholder="Ex: Quero clonar Instagram com Stories, Reels e sistema de comentários aninhados..."
                      rows={8}
                      disabled={submitting}
                    />
                  </Field.Control>
                  <Field.Hint>
                    Mínimo 10 caracteres, máximo 2000. Seja específico sobre funcionalidades.
                  </Field.Hint>
                </Field>
              </>
            )}

            {isGenerating && (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Vitor está gerando PRDs estruturados...
                </p>
                <Badge variant="secondary" className="font-mono text-xs">
                  {jobStatus === "queued" ? "Na fila" : "Processando"}
                </Badge>
              </div>
            )}

            {hasFailed && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-4">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-destructive">
                    Erro ao gerar PRDs
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {error || "Erro desconhecido"}
                  </p>
                </div>
              </div>
            )}

            {isDone && prds.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    PRDs gerados ({prds.length})
                  </p>
                  <Badge variant="outline" className="text-xs">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Completo
                  </Badge>
                </div>

                <div className="space-y-2">
                  {prds.map((prd) => (
                    <div
                      key={prd.id}
                      className="flex flex-col gap-2 rounded-lg border p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{prd.title}</p>
                          {prd.goal && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {prd.goal}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant="secondary" className="text-[10px]">
                              {prd.acceptanceCriteria.length} critérios
                            </Badge>
                            <Badge
                              variant={prd.status === "ready" ? "default" : "outline"}
                              className="text-[10px]"
                            >
                              {prd.status}
                            </Badge>
                          </div>
                        </div>
                        {prd.status === "draft" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleApproveOne(prd.id)}
                            disabled={approving}
                          >
                            {approving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                            Aprovar
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </FormBody>
        </ResponsiveSheetBody>

        <ResponsiveSheetFooter>
          {!jobId && (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button onClick={handleSubmit} disabled={!brief.trim() || submitting}>
                {submitting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Gerar PRDs
              </Button>
            </>
          )}

          {hasFailed && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
              <Button onClick={handleReset}>Tentar novamente</Button>
            </>
          )}

          {isDone && prds.length > 0 && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
              {prds.some((p) => p.status === "draft") && (
                <Button onClick={handleApproveAll} disabled={approving}>
                  {approving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  Aprovar todos ({prds.filter((p) => p.status === "draft").length})
                </Button>
              )}
            </>
          )}
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
