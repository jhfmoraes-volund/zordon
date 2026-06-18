"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Info, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ConfirmState } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { fmtDate } from "@/lib/date-utils";
import { EMPHASIS_TEXT_MAX } from "@/lib/rituals/types";
import type { RitualCapability } from "@/lib/rituals/types";
import type {
  GranolaFoldersResponse,
  GranolaFolderBinding,
} from "@/app/api/projects/[id]/granola-folders/route";
import type { FolderFreshness } from "@/app/api/projects/[id]/granola-folders/[bindingId]/freshness/route";

type Props = {
  projectId: string;
  ritualType: "pm_review";
};

type DriveSource = { id: string; title: string; capturedAt: string | null };

type PlaybookResponse = {
  ritualType: string;
  capabilities: RitualCapability[];
  enabled: boolean;
  updatedAt: string | null;
  driveSources: DriveSource[];
};

const RITUAL_TITLE: Record<Props["ritualType"], string> = {
  pm_review: "PM Review",
};

const INSTRUCTION_TOOLTIP =
  "É a 'skill' deste ritual: uma instrução livre pra Vitoria — diga o foco, o tom e o que priorizar ao gerar o report. Vale qualquer texto; ela não muda a estrutura do report.";

function isLoadContext(
  c: RitualCapability,
): c is Extract<RitualCapability, { capabilityKey: "load_context" }> {
  return c.capabilityKey === "load_context";
}

function isEmphasis(
  c: RitualCapability,
): c is Extract<RitualCapability, { capabilityKey: "emphasis" }> {
  return c.capabilityKey === "emphasis";
}

/** contextSourceId de uma cap de drive (load_context não-granola). */
function driveRefId(c: Extract<RitualCapability, { capabilityKey: "load_context" }>): string | null {
  return c.params.ref.contextSourceId ?? null;
}

/**
 * AutomationRitualCard — card de automação por tipo de ritual (PoC: PM Review).
 * Funde o liga/desliga + agenda (cron em dias úteis ~08h BRT), a config de
 * fontes (folders do Granola, já curadas out-of-band + arquivos do Drive, com
 * freshness real) e a instrução livre do PM, que orienta a Vitoria ao conduzir.
 *
 * As fontes Granola vêm de ProjectGranolaFolder (nunca do playbook) e são só
 * exibidas — o picker adiciona apenas Drive. As fontes Drive são capabilities
 * load_context(drive_file) no playbook. A instrução é a capability emphasis.
 * Salvar a instrução re-emite o playbook inteiro (drive caps + emphasis + o
 * flag enabled atual), então o estado local é mantido sincronizado.
 */
export function AutomationRitualCard({ projectId, ritualType }: Props) {
  const [loading, setLoading] = useState(true);

  // ── Liga/desliga da automação (default OFF: opt-in explícito) ──
  const [enabled, setEnabled] = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);

  // ── Granola (só exibido; picker não adiciona granola) ────
  const [needsAuth, setNeedsAuth] = useState(false);
  const [granolaError, setGranolaError] = useState<string | null>(null);
  const [bindings, setBindings] = useState<GranolaFolderBinding[]>([]);
  const [freshness, setFreshness] = useState<Record<string, FolderFreshness | "loading">>({});

  // ── Drive (vive no playbook como load_context caps) ──────
  const [driveCaps, setDriveCaps] = useState<
    Extract<RitualCapability, { capabilityKey: "load_context" }>[]
  >([]);
  const [driveSources, setDriveSources] = useState<DriveSource[]>([]);

  // ── Picker (só Drive) + instrução ────────────────────────
  const [pick, setPick] = useState<string>(""); // contextSourceId do arquivo Drive
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [initialText, setInitialText] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // ── Carrega freshness de um binding Granola ──────────────
  async function loadFreshness(bindingId: string) {
    setFreshness((prev) => ({ ...prev, [bindingId]: "loading" }));
    try {
      const res = await fetchOrThrow(
        `/api/projects/${projectId}/granola-folders/${bindingId}/freshness`,
      );
      const data = (await res.json()) as FolderFreshness;
      setFreshness((prev) => ({ ...prev, [bindingId]: data }));
    } catch {
      setFreshness((prev) => ({
        ...prev,
        [bindingId]: {
          state: "error",
          weekCount: 0,
          hasMore: false,
          lastNoteAt: null,
          lastNoteTitle: null,
          error: "Falha ao consultar a folder.",
        },
      }));
    }
  }

  // ── Carga inicial (granola + playbook em paralelo) ───────
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const [granolaRes, playbookRes] = await Promise.all([
          fetchOrThrow(`/api/projects/${projectId}/granola-folders`),
          fetchOrThrow(
            `/api/projects/${projectId}/ritual-playbook?ritualType=${ritualType}`,
          ),
        ]);
        const granola = (await granolaRes.json()) as GranolaFoldersResponse;
        const playbook = (await playbookRes.json()) as PlaybookResponse;
        if (!active) return;

        setNeedsAuth(granola.needsAuth);
        setGranolaError(granola.error ?? null);
        setBindings(granola.bindings);

        setEnabled(playbook.enabled);

        // Só fontes não-granola: granola vive em ProjectGranolaFolder, nunca no
        // playbook row. Filtro defensivo caso uma cap granola tenha vazado.
        const drive = playbook.capabilities
          .filter(isLoadContext)
          .filter((c) => c.params.kind !== "granola_folder");
        setDriveCaps(drive);
        setDriveSources(playbook.driveSources);

        const emphasis = playbook.capabilities.find(isEmphasis);
        const seeded = emphasis?.params.text ?? "";
        setText(seeded);
        setInitialText(seeded);

        // Freshness das folders Granola, em paralelo.
        for (const b of granola.bindings) void loadFreshness(b.id);
      } catch (err) {
        if (active) showErrorToast(err, { label: "Falha ao carregar o ritual" });
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, ritualType]);

  // ── PUT do playbook (drive caps + emphasis + enabled). Fonte única do
  //    contrato. `nextEnabled` default mantém o estado atual — a rota PUT
  //    re-defaulta `enabled` pra true se omitido, então sempre enviamos. ──
  async function putPlaybook(
    nextDrive: Extract<RitualCapability, { capabilityKey: "load_context" }>[],
    emphasisText: string,
    nextEnabled: boolean = enabled,
  ) {
    const trimmed = emphasisText.trim();
    const capabilities: RitualCapability[] = [
      ...nextDrive,
      ...(trimmed
        ? [{ capabilityKey: "emphasis" as const, enabled: true, params: { text: trimmed } }]
        : []),
    ];
    await fetchOrThrow(`/api/projects/${projectId}/ritual-playbook`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ritualType, capabilities, enabled: nextEnabled }),
    });
  }

  // ── Liga/desliga: PUT com as mesmas caps + novo enabled ──
  async function toggleEnabled() {
    const next = !enabled;
    setTogglingEnabled(true);
    setEnabled(next); // otimista
    try {
      await putPlaybook(driveCaps, text, next);
      if (next) {
        // Bootstrap: ligar roda o PM Review desta semana 1× — acha-ou-cria o
        // draft agora, sem esperar o cron de amanhã.
        try {
          const res = await fetchOrThrow(
            `/api/projects/${projectId}/pm-review/refresh`,
            { method: "POST" },
          );
          const out = (await res.json()) as { status?: string };
          toast.success(
            out.status === "enqueued"
              ? "Automação ligada — gerando o PM Review desta semana…"
              : "Automação ligada. O PM Review aparece assim que houver reunião nova na folder.",
          );
        } catch {
          // Ligou, mas o disparo inicial falhou — não reverte o toggle; o cron
          // pega no próximo ciclo.
          toast.success("Automação ligada.");
          toast.message("O PM Review será gerado no próximo ciclo (dias úteis, ~08h).");
        }
      } else {
        toast.success("Automação desligada.");
      }
    } catch (err) {
      setEnabled(!next); // reverte
      showErrorToast(err, { label: "Falha ao alterar a automação" });
    } finally {
      setTogglingEnabled(false);
    }
  }

  // ── Opções do picker (Drive ainda não vinculado) ─────────
  const boundDriveIds = useMemo(
    () => new Set(driveCaps.map(driveRefId).filter((x): x is string => !!x)),
    [driveCaps],
  );
  const driveOptions = useMemo(
    () => driveSources.filter((d) => !boundDriveIds.has(d.id)),
    [driveSources, boundDriveIds],
  );

  const driveTitle = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of driveSources) m.set(d.id, d.title);
    return m;
  }, [driveSources]);
  const driveCapturedAt = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const d of driveSources) m.set(d.id, d.capturedAt);
    return m;
  }, [driveSources]);

  // ── Adicionar fonte (só Drive → load_context(drive_file) + PUT) ──
  async function addSource() {
    if (!pick) return;
    setAdding(true);
    try {
      const nextDrive = [
        ...driveCaps,
        {
          capabilityKey: "load_context" as const,
          enabled: true,
          params: { kind: "drive_file" as const, ref: { contextSourceId: pick } },
        },
      ];
      await putPlaybook(nextDrive, text);
      setDriveCaps(nextDrive);
      setPick("");
    } catch (err) {
      showErrorToast(err, { label: "Falha ao vincular fonte" });
    } finally {
      setAdding(false);
    }
  }

  // ── Remover Granola (DELETE) ─────────────────────────────
  function askRemoveGranola(b: GranolaFolderBinding) {
    const label = b.folderName ?? b.folderId;
    setConfirm({
      title: "Desvincular fonte?",
      description: `A folder "${label}" deixará de alimentar o ${RITUAL_TITLE[ritualType]} deste projeto.`,
      confirmLabel: "Desvincular",
      destructive: true,
      onConfirm: async () => {
        try {
          await fetchOrThrow(
            `/api/projects/${projectId}/granola-folders/${b.id}`,
            { method: "DELETE" },
          );
          setBindings((prev) => prev.filter((x) => x.id !== b.id));
        } catch (err) {
          showErrorToast(err, { label: "Falha ao desvincular fonte" });
        }
      },
    });
  }

  // ── Remover Drive (drop da cap + PUT) ────────────────────
  function askRemoveDrive(contextSourceId: string) {
    const label = driveTitle.get(contextSourceId) ?? "Arquivo do Drive";
    setConfirm({
      title: "Desvincular fonte?",
      description: `O arquivo "${label}" deixará de alimentar o ${RITUAL_TITLE[ritualType]} deste projeto.`,
      confirmLabel: "Desvincular",
      destructive: true,
      onConfirm: async () => {
        const nextDrive = driveCaps.filter((c) => driveRefId(c) !== contextSourceId);
        try {
          await putPlaybook(nextDrive, text);
          setDriveCaps(nextDrive);
        } catch (err) {
          showErrorToast(err, { label: "Falha ao desvincular fonte" });
        }
      },
    });
  }

  // ── Salvar instrução ─────────────────────────────────────
  const trimmed = text.trim();
  const dirty = trimmed !== initialText.trim();

  async function saveInstruction() {
    setSaving(true);
    try {
      await putPlaybook(driveCaps, text);
      setInitialText(trimmed);
      setText(trimmed);
      toast.success("Instrução salva.");
    } catch (err) {
      showErrorToast(err, { label: "Falha ao salvar a instrução" });
    } finally {
      setSaving(false);
    }
  }

  function freshnessLabel(bindingId: string): ReactNode {
    const f = freshness[bindingId];
    if (f === "loading" || f === undefined) {
      return <span className="text-xs text-muted-foreground">verificando…</span>;
    }
    if (f.state === "fresh") {
      return (
        <span className="text-xs text-emerald-600">
          ✓ {f.weekCount} nota(s) esta semana{f.hasMore ? "+" : ""}
        </span>
      );
    }
    if (f.state === "stale") {
      return <span className="text-xs text-amber-600">nenhuma nota esta semana</span>;
    }
    if (f.state === "orphan") {
      return <span className="text-xs text-amber-600">órfã — reconecte</span>;
    }
    return (
      <span className="text-xs text-muted-foreground">{f.error ?? "erro"}</span>
    );
  }

  const hasSources = bindings.length > 0 || driveCaps.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{RITUAL_TITLE[ritualType]}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-xs text-muted-foreground">
          As fontes alimentam o ritual com contexto; a instrução orienta como a
          Vitoria o conduz.
        </p>

        {loading ? (
          <p className="text-xs text-muted-foreground">Carregando…</p>
        ) : (
          <>
            {/* ── Status + agenda + liga/desliga (cara de conectado) ── */}
            <section
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                enabled ? "border-primary/30 bg-primary/5" : "border-border bg-muted/30",
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={cn(
                    "relative flex size-2.5 shrink-0 rounded-full",
                    enabled ? "bg-emerald-500" : "bg-muted-foreground/40",
                  )}
                  aria-hidden
                >
                  {enabled && !togglingEnabled ? (
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60" />
                  ) : null}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {enabled ? "Automação conectada" : "Automação desligada"}
                  </p>
                  <p className={cn("text-xs", enabled ? "text-muted-foreground" : "text-amber-600")}>
                    {togglingEnabled
                      ? "Salvando…"
                      : enabled
                        ? "Roda em dias úteis, ~08h (BRT)."
                        : "O cron não gera o PM Review deste projeto."}
                  </p>
                </div>
              </div>
              <Switch
                checked={enabled}
                disabled={togglingEnabled}
                onCheckedChange={() => void toggleEnabled()}
                aria-label="Automação"
              />
            </section>

            {/* ── Seção 1: Fontes de contexto ── */}
            <section className="space-y-2.5">
              <h4 className="text-sm font-medium">Fontes de contexto</h4>

              {granolaError ? (
                <p className="text-xs text-destructive">{granolaError}</p>
              ) : null}

              {hasSources ? (
                <ul className="space-y-1.5">
                  {bindings.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            Granola
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {b.folderName ?? b.folderId}
                          </span>
                        </div>
                        <div className="mt-0.5">{freshnessLabel(b.id)}</div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        aria-label="Atualizar freshness"
                        onClick={() => void loadFreshness(b.id)}
                      >
                        <RefreshCw className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        aria-label="Desvincular fonte"
                        onClick={() => askRemoveGranola(b)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                  {driveCaps.map((c) => {
                    const id = driveRefId(c);
                    if (!id) return null;
                    return (
                      <li
                        key={id}
                        className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              Drive
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                              {driveTitle.get(id) ?? "Arquivo do Drive"}
                            </span>
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            atualizado {fmtDate(driveCapturedAt.get(id) ?? null)}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0"
                          aria-label="Desvincular fonte"
                          onClick={() => askRemoveDrive(id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Nenhuma fonte vinculada ainda.
                </p>
              )}

              {needsAuth && driveOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Conecte sua conta Granola na aba Integrações para vincular
                  folders, ou importe arquivos do Drive no pool do projeto.
                </p>
              ) : null}

              {driveOptions.length > 0 ? (
                <div className="flex gap-2">
                  <Select value={pick} onValueChange={(v) => setPick(v ?? "")}>
                    <SelectTrigger className="min-w-0 flex-1">
                      <SelectValue placeholder="Adicionar fonte…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Drive</SelectLabel>
                        {driveOptions.map((d) => (
                          <SelectItem key={`d-${d.id}`} value={d.id}>
                            {d.title}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button onClick={addSource} disabled={adding || !pick}>
                    {adding ? "Vinculando…" : "Vincular"}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Nenhuma fonte adicional disponível — importe arquivos no app Drive.
                </p>
              )}
            </section>

            {/* ── Seção 2: Instrução do PM ── */}
            <section className="space-y-1.5">
              <h4 className="text-sm font-medium">Instrução do PM</h4>
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Instrução do PM (skill desta automação)
                </label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger
                      type="button"
                      aria-label="O que é a instrução do PM"
                      className="text-muted-foreground"
                    >
                      <Info className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipContent>{INSTRUCTION_TOOLTIP}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Textarea
                value={text}
                maxLength={EMPHASIS_TEXT_MAX}
                onChange={(e) => setText(e.target.value)}
                placeholder="Detalhe o foco / como conduzir este ritual…"
              />
              <p className="text-right text-xs text-muted-foreground">
                {text.length}/{EMPHASIS_TEXT_MAX}
              </p>
              <div className="flex justify-end">
                <Button onClick={saveInstruction} disabled={saving || !dirty}>
                  {saving ? "Salvando…" : "Salvar"}
                </Button>
              </div>
            </section>
          </>
        )}
      </CardContent>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </Card>
  );
}
