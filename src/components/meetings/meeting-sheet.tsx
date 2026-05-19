"use client";

import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import { createClient } from "@/lib/supabase/client";
import { showErrorToast, fetchOrThrow } from "@/lib/optimistic/toast";
import { Plus, X, Download, Lock } from "lucide-react";
import { ImportMeetingModal } from "./import-meeting-modal";
import { ProjectPicker } from "@/components/projects/project-picker";
import { useAuth } from "@/contexts/auth-context";

type Member = { id: string; name: string; role: string };
type Project = { id: string; name: string; status: string };
type Sprint = { id: string; name: string; status: string; projectId: string };
type ExternalAttendee = { name: string; email: string; role: string };

export type MeetingType =
  | "pm_review"
  | "general"
  | "daily"
  | "super_planning"
  | "private";

const TYPE_DESCRIPTIONS: Record<MeetingType, string> = {
  pm_review:
    "Selecione 1 ou mais PMs participantes. Os projetos ativos de cada PM serão revisados (próximos passos, saudabilidade, pontos de atenção, OBS) e ações pendentes da última reunião concluída serão trazidas.",
  general:
    "Reunião sem revisão estruturada. Você pode juntar projetos relacionados (opcional) e registrar pontos de ação.",
  daily:
    "Daily de um projeto. Discuta progresso, blockers e plano de ação sobre as tasks da sprint atual. Para pautas que cruzam projetos, use Reunião geral.",
  super_planning:
    "Planejamento da sprint atual de um projeto (segundas-feiras). Sugestões de IA + aprovação manual de criação/edição/movimentação de tasks.",
  private:
    "Reunião privada — só você vê. Importe a transcrição do Granola; Alpha gera notes e To-dos pra você. Vincular projetos (opcional) permite que Alpha proponha Tasks naqueles projetos pra você aprovar depois.",
};

const TYPE_LABELS: Record<MeetingType, string> = {
  pm_review: "Reunião com PMs",
  general: "Reunião geral",
  daily: "Daily",
  super_planning: "Super Planning",
  private: "Privada",
};

export type MeetingEditInitial = {
  id: string;
  type: MeetingType;
  date: string;
  title: string | null;
  notes: string | null;
  attendees: {
    memberId: string | null;
    externalName: string | null;
    externalEmail: string | null;
    externalRole: string | null;
    role: string | null;
  }[];
  projectLinks: { project: { id: string } | null }[];
  projectReviews: { member: { id: string } | null }[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  meeting?: MeetingEditInitial | null;
  defaultType?: MeetingType;
  onSaved: (meeting: { id: string }) => void;
};

function deriveTitle(
  type: MeetingType,
  ctx: { pmNames: string[]; projectNames: string[] },
): string {
  if (type === "pm_review") return ctx.pmNames.join(", ") || "";
  if (type === "daily" || type === "super_planning")
    return ctx.projectNames.join(", ") || "";
  return "";
}

export function MeetingSheet({
  open,
  onOpenChange,
  mode,
  meeting,
  defaultType,
  onSaved,
}: Props) {
  const isMobile = useIsMobile();
  const { member: currentMember } = useAuth();
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);

  const [type, setType] = useState<MeetingType>(defaultType ?? "pm_review");
  const [date, setDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");

  const [pmIds, setPmIds] = useState<Set<string>>(new Set());
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  // Squad of the currently selected project(s), for daily/super_planning. Drives
  // the "Squad" vs "Convidados" UI grouping and gets merged into memberIds when
  // the project changes.
  const [autoSelectedIds, setAutoSelectedIds] = useState<Set<string>>(new Set());
  const [projectIds, setProjectIds] = useState<Set<string>>(new Set());
  const [externals, setExternals] = useState<ExternalAttendee[]>([]);
  const [extName, setExtName] = useState("");
  const [extEmail, setExtEmail] = useState("");
  const [extRole, setExtRole] = useState("");

  // Carrega dados de referência
  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    Promise.all([
      supabase.from("Member").select("id, name, role").order("name"),
      supabase
        .from("Project")
        .select("id, name, status")
        .eq("status", "active")
        .order("name"),
      supabase.from("Sprint").select("id, name, status, projectId").eq("status", "active"),
    ]).then(([m, p, s]) => {
      setMembers((m.data ?? []) as Member[]);
      setProjects((p.data ?? []) as Project[]);
      setSprints((s.data ?? []) as Sprint[]);
    });
  }, [open]);

  // Hidrata estado quando abre (reset no create, populate no edit)
  useEffect(() => {
    if (!open) return;

    if (mode === "edit" && meeting) {
      setType(meeting.type);
      setDate(meeting.date.slice(0, 10));
      setTitle(meeting.title ?? "");
      setNotes(meeting.notes ?? "");

      if (meeting.type === "pm_review") {
        // Em pm_review, todos os attendees são PMs por design — antigos podem
        // ter role=null (criados antes da convenção role="pm"). Aceitar ambos.
        const pms = new Set<string>();
        for (const r of meeting.projectReviews) {
          if (r.member?.id) pms.add(r.member.id);
        }
        for (const a of meeting.attendees) {
          if (a.memberId) pms.add(a.memberId);
        }
        setPmIds(pms);
        setMemberIds(new Set());
        setExternals([]);
      } else {
        setPmIds(new Set());
        const internal = new Set(
          meeting.attendees
            .filter((a) => a.memberId && a.role !== "external")
            .map((a) => a.memberId!),
        );
        setMemberIds(internal);
        setExternals(
          meeting.attendees
            .filter((a) => a.role === "external" && a.externalName)
            .map((a) => ({
              name: a.externalName!,
              email: a.externalEmail ?? "",
              role: a.externalRole ?? "",
            })),
        );
      }
      setProjectIds(
        new Set(
          meeting.projectLinks
            .map((l) => l.project?.id)
            .filter((id): id is string => !!id),
        ),
      );
    } else {
      // create — reset
      setType(defaultType ?? "pm_review");
      setDate(new Date().toISOString().slice(0, 10));
      setTitle("");
      setNotes("");
      setPmIds(new Set());
      setMemberIds(new Set());
      setAutoSelectedIds(new Set());
      setProjectIds(new Set());
      setExternals([]);
      setExtName("");
      setExtEmail("");
      setExtRole("");
    }
  }, [open, mode, meeting, defaultType]);

  // Auto-select the project's squad as attendees for daily/super_planning.
  // When the linked project changes, swap the old squad out of memberIds and
  // bring the new one in. Manual additions (guests not in any squad) and
  // manual removals (members the PM unchecked) survive the swap.
  const projectKey = useMemo(
    () => Array.from(projectIds).sort().join("|"),
    [projectIds],
  );
  useEffect(() => {
    if (!open) return;
    if (type !== "daily" && type !== "super_planning") {
      if (autoSelectedIds.size > 0) setAutoSelectedIds(new Set());
      return;
    }
    if (projectIds.size === 0) {
      if (autoSelectedIds.size > 0) {
        setMemberIds((prev) => {
          const next = new Set(prev);
          for (const id of autoSelectedIds) next.delete(id);
          return next;
        });
        setAutoSelectedIds(new Set());
      }
      return;
    }

    let cancelled = false;
    const ids = Array.from(projectIds);
    Promise.all(
      ids.map((id) =>
        fetch(`/api/projects/${id}/members`).then((r) =>
          r.ok ? (r.json() as Promise<{ id: string }[]>) : [],
        ),
      ),
    ).then((lists) => {
      if (cancelled) return;
      const fresh = new Set<string>();
      for (const list of lists) for (const m of list) fresh.add(m.id);

      // On edit hydration, don't auto-add — just record what the squad currently
      // is so the UI can group, but leave memberIds alone (PM's historical
      // decision wins).
      const isInitialEditHydration =
        mode === "edit" && autoSelectedIds.size === 0 && memberIds.size > 0;

      if (!isInitialEditHydration) {
        setMemberIds((prev) => {
          const next = new Set(prev);
          for (const id of autoSelectedIds) {
            if (!fresh.has(id)) next.delete(id);
          }
          for (const id of fresh) next.add(id);
          return next;
        });
      }
      setAutoSelectedIds(fresh);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type, projectKey, mode]);

  const pms = useMemo(() => members.filter((m) => m.role === "pm"), [members]);

  const toggleInSet =
    (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (id: string) =>
      setter((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });

  const togglePm = toggleInSet(setPmIds);
  const toggleMember = toggleInSet(setMemberIds);

  const addExternal = () => {
    if (!extName.trim()) return;
    setExternals((prev) => [
      ...prev,
      { name: extName.trim(), email: extEmail.trim(), role: extRole.trim() },
    ]);
    setExtName("");
    setExtEmail("");
    setExtRole("");
  };

  const removeExternal = (i: number) =>
    setExternals((prev) => prev.filter((_, idx) => idx !== i));

  const switchType = (next: MeetingType) => {
    if (mode === "edit") return; // tipo trancado no edit
    setType(next);
    setProjectIds(new Set());
    setPmIds(new Set());
    setMemberIds(new Set());
    setAutoSelectedIds(new Set());
    setExternals([]);
    setTitle("");
  };

  // Sugestão de título derivada (placeholder)
  const derivedTitle = useMemo(() => {
    const pmNames = Array.from(pmIds)
      .map((id) => members.find((m) => m.id === id)?.name)
      .filter(Boolean) as string[];
    const projectNames = Array.from(projectIds)
      .map((id) => projects.find((p) => p.id === id)?.name)
      .filter(Boolean) as string[];
    return deriveTitle(type, { pmNames, projectNames });
  }, [type, pmIds, projectIds, members, projects]);

  const showProjectPicker =
    type === "daily" ||
    type === "super_planning" ||
    type === "general" ||
    type === "private";
  const showMemberPicker =
    type === "general" || type === "daily" || type === "super_planning";
  const showExternalsPicker = type === "general";
  const showPmPicker = type === "pm_review";

  const selectedProjectId =
    type === "super_planning" ? Array.from(projectIds)[0] : null;
  const selectedProjectHasSprint = selectedProjectId
    ? sprints.some((s) => s.projectId === selectedProjectId)
    : true;

  const projectsLocked = mode === "edit" && type === "super_planning";

  const canSubmit = () => {
    if (!date) return false;
    if (type === "pm_review") return pmIds.size > 0;
    if (type === "daily") return projectIds.size === 1;
    if (type === "super_planning") {
      if (projectIds.size !== 1) return false;
      const pid = Array.from(projectIds)[0];
      return sprints.some((s) => s.projectId === pid);
    }
    if (type === "private") {
      // Só precisa do owner (Member do user logado) — sem PMs, sem squad.
      return !!currentMember?.id;
    }
    return memberIds.size > 0 || externals.length > 0;
  };

  function buildAttendees() {
    if (type === "pm_review") {
      return Array.from(pmIds).map((id) => ({ memberId: id, role: "pm" }));
    }
    if (type === "private") {
      if (!currentMember?.id) return [];
      return [{ memberId: currentMember.id, role: "owner" }];
    }
    if (type === "daily" || type === "super_planning") {
      return Array.from(memberIds).map((id) => ({
        memberId: id,
        role: "attendee",
      }));
    }
    return [
      ...Array.from(memberIds).map((id) => ({
        memberId: id,
        role: "attendee",
      })),
      ...externals.map((e) => ({
        externalName: e.name,
        externalEmail: e.email || null,
        externalRole: e.role || null,
        role: "external",
      })),
    ];
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const attendees = buildAttendees();

      if (mode === "create") {
        const body = {
          type,
          date: `${date}T12:00:00`,
          title: title.trim() || null,
          notes: notes.trim() || null,
          pmMemberIds: type === "pm_review" ? Array.from(pmIds) : [],
          attendees,
          projectIds: ["general", "daily", "super_planning", "private"].includes(type)
            ? Array.from(projectIds)
            : [],
        };
        const res = await fetchOrThrow("/api/meetings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const created = await res.json();
        onSaved(created);
        onOpenChange(false);
      } else {
        if (!meeting) return;
        const body: Record<string, unknown> = {
          date: `${date}T12:00:00`,
          title: title.trim() || null,
          notes: notes.trim() || null,
        };
        if (type === "pm_review") {
          body.pmMemberIds = Array.from(pmIds).filter(
            (x): x is string => typeof x === "string" && x.length > 0,
          );
        } else {
          body.attendees = attendees;
          if (type !== "super_planning") {
            body.projectIds = Array.from(projectIds);
          }
        }
        const res = await fetchOrThrow(`/api/meetings/${meeting.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const updated = await res.json();
        onSaved(updated);
        onOpenChange(false);
      }
    } catch (e) {
      showErrorToast(e, {
        label: mode === "create" ? "Criar reunião" : "Salvar reunião",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={
          isMobile
            ? "h-[90dvh] max-h-[90dvh] gap-0 rounded-t-xl p-0 flex flex-col"
            : "w-full sm:max-w-xl gap-0 p-0 flex flex-col"
        }
      >
        {isMobile && (
          <div
            aria-hidden="true"
            className="absolute top-2 left-1/2 -translate-x-1/2 h-1.5 w-12 rounded-full bg-muted z-10"
          />
        )}
        <div className="shrink-0 border-b px-6 pt-6 pb-4">
          <h2 className="font-heading text-base font-medium">
            {mode === "create" ? "Nova Reunião" : "Editar Reunião"}
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Type toggle */}
          <div className="grid gap-2">
            <Label>Tipo {mode === "edit" && <span className="text-xs text-muted-foreground">(não pode ser alterado)</span>}</Label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  "pm_review",
                  "general",
                  "daily",
                  "super_planning",
                  "private",
                ] as MeetingType[]
              ).map((t) => (
                <Button
                  key={t}
                  type="button"
                  variant={type === t ? "default" : "outline"}
                  size="sm"
                  disabled={mode === "edit" && type !== t}
                  onClick={() => switchType(t)}
                >
                  {t === "private" && <Lock className="h-3 w-3 mr-1" />}
                  {TYPE_LABELS[t]}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{TYPE_DESCRIPTIONS[type]}</p>
          </div>

          {/* Data */}
          <div className="grid gap-2 max-w-xs">
            <Label>Data da reunião</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* Título — sempre visível com placeholder derivado */}
          <div className="grid gap-2">
            <Label>Título</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                derivedTitle
                  ? `Sugestão: ${derivedTitle}`
                  : "Ex: Alinhamento com cliente, Planejamento Q3..."
              }
            />
            {!title && derivedTitle && (
              <p className="text-xs text-muted-foreground">
                Vazio: usaremos a sugestão como título.
              </p>
            )}
          </div>

          {/* PMs (pm_review) */}
          {showPmPicker && (
            <div className="grid gap-2">
              <Label>PMs participantes</Label>
              <div className="flex flex-wrap gap-2">
                {pms.length === 0 && (
                  <span className="text-sm text-muted-foreground">
                    Nenhum PM cadastrado.
                  </span>
                )}
                {pms.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => togglePm(m.id)}
                    className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
                      pmIds.has(m.id)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-accent"
                    }`}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
              {mode === "edit" && (
                <p className="text-xs text-muted-foreground">
                  Adicionar um PM gera reviews para os projetos ativos dele. Remover só é
                  permitido se o review estiver vazio.
                </p>
              )}
            </div>
          )}

          {/* Projetos */}
          {showProjectPicker && (
            <div className="grid gap-2">
              <Label>
                {type === "super_planning" || type === "daily"
                  ? "Projeto"
                  : type === "private"
                    ? "Projetos pra propor Tasks (opcional)"
                    : "Projetos vinculados (opcional)"}
                {projectsLocked && (
                  <span className="ml-2 text-xs text-muted-foreground">(travado)</span>
                )}
              </Label>
              {type === "private" && (
                <p className="text-xs text-muted-foreground -mt-1">
                  Se selecionar, Alpha pode propor Tasks nesses projetos a partir da
                  transcrição. Você aprova depois.
                </p>
              )}
              <ProjectPicker
                mode={
                  type === "super_planning" || type === "daily"
                    ? "single"
                    : "multi"
                }
                available={projects.map((p) => ({
                  id: p.id,
                  name: p.name,
                  hasActiveSprint: sprints.some((s) => s.projectId === p.id),
                }))}
                selectedIds={Array.from(projectIds)}
                onChange={(ids) => setProjectIds(new Set(ids))}
                disabled={projectsLocked}
                showSprintHint={type === "super_planning"}
                placeholder={
                  type === "super_planning" || type === "daily"
                    ? "Selecionar projeto"
                    : "Vincular projetos"
                }
                emptyText="Nenhum projeto ativo"
              />
              {type === "super_planning" &&
                selectedProjectId &&
                !selectedProjectHasSprint && (
                  <p className="text-xs text-destructive">
                    Esse projeto não tem sprint ativa. Crie ou ative uma sprint antes.
                  </p>
                )}
            </div>
          )}

          {/* Membros internos */}
          {showMemberPicker && (
            <MemberPicker
              type={type}
              members={members}
              memberIds={memberIds}
              autoSelectedIds={autoSelectedIds}
              onToggle={toggleMember}
            />
          )}

          {/* Externos (general) */}
          {showExternalsPicker && (
            <div className="grid gap-2">
              <Label>Externos (opcional)</Label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:flex-wrap">
                <div className="grid gap-1 w-full sm:flex-1 sm:min-w-[140px]">
                  <Label className="text-xs text-muted-foreground">Nome</Label>
                  <Input
                    value={extName}
                    onChange={(e) => setExtName(e.target.value)}
                    placeholder="Nome"
                  />
                </div>
                <div className="grid gap-1 w-full sm:flex-1 sm:min-w-[160px]">
                  <Label className="text-xs text-muted-foreground">E-mail</Label>
                  <Input
                    value={extEmail}
                    onChange={(e) => setExtEmail(e.target.value)}
                    placeholder="email@..."
                  />
                </div>
                <div className="grid gap-1 w-full sm:flex-1 sm:min-w-[120px]">
                  <Label className="text-xs text-muted-foreground">Cargo</Label>
                  <Input
                    value={extRole}
                    onChange={(e) => setExtRole(e.target.value)}
                    placeholder="Cargo"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={addExternal}
                  className="w-full sm:w-9 sm:h-9 sm:p-0 sm:shrink-0"
                >
                  <Plus className="h-4 w-4" />
                  <span className="sm:hidden ml-1">Adicionar externo</span>
                </Button>
              </div>
              {externals.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {externals.map((e, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-muted text-sm"
                    >
                      {e.name}
                      {e.role && (
                        <span className="text-xs text-muted-foreground">
                          ({e.role})
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeExternal(i)}
                        className="hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Notas */}
          <div className="grid gap-2">
            <Label>Notas gerais (opcional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observações gerais sobre a reunião..."
              rows={3}
            />
          </div>
        </div>

        <div className="shrink-0 sticky bottom-0 border-t bg-popover px-6 py-3 pb-safe flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {mode === "create" && (
            <Button
              variant="outline"
              onClick={() => setImportOpen(true)}
              disabled={saving || !canSubmit()}
              title={
                type === "private"
                  ? "Cria a reunião privada a partir da transcrição do Granola"
                  : "Cria a reunião e deixa o Alpha popular a partir de uma transcrição do Roam"
              }
            >
              <Download className="h-4 w-4 mr-1" />
              {type === "private" ? "Importar do Granola" : "Importar reunião"}
            </Button>
          )}
          <Button onClick={save} disabled={!canSubmit() || saving}>
            {saving
              ? mode === "create"
                ? "Criando…"
                : "Salvando…"
              : mode === "create"
                ? "Criar reunião"
                : "Salvar"}
          </Button>
        </div>
        {mode === "create" && (
          <ImportMeetingModal
            open={importOpen}
            onOpenChange={setImportOpen}
            mode="create"
            type={type}
            pmMemberIds={Array.from(pmIds)}
            attendees={buildAttendees()}
            projectIds={
              ["general", "daily", "super_planning", "private"].includes(type)
                ? Array.from(projectIds)
                : []
            }
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── MemberPicker ─────────────────────────────────────────────────────────────

function MemberChip({
  member,
  selected,
  onToggle,
}: {
  member: Member;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
        selected
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background hover:bg-accent"
      }`}
    >
      {member.name}
    </button>
  );
}

function MemberPicker({
  type,
  members,
  memberIds,
  autoSelectedIds,
  onToggle,
}: {
  type: MeetingType;
  members: Member[];
  memberIds: Set<string>;
  autoSelectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const isSquadType = type === "daily" || type === "super_planning";
  if (!isSquadType) {
    return (
      <div className="grid gap-2">
        <Label>
          {type === "general" ? "Membros participantes" : "Participantes (opcional)"}
        </Label>
        <div className="flex flex-wrap gap-2">
          {members.map((m) => (
            <MemberChip
              key={m.id}
              member={m}
              selected={memberIds.has(m.id)}
              onToggle={() => onToggle(m.id)}
            />
          ))}
        </div>
      </div>
    );
  }

  // daily/super_planning: split into squad (auto) and guests (everyone else)
  const squad = members.filter((m) => autoSelectedIds.has(m.id));
  const others = members.filter((m) => !autoSelectedIds.has(m.id));
  const guestSelected = others.filter((m) => memberIds.has(m.id));

  return (
    <div className="grid gap-2">
      <Label>
        Squad do projeto
        {squad.length === 0 && (
          <span className="ml-2 text-xs text-muted-foreground">
            (selecione um projeto primeiro)
          </span>
        )}
      </Label>
      {squad.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {squad.map((m) => (
            <MemberChip
              key={m.id}
              member={m}
              selected={memberIds.has(m.id)}
              onToggle={() => onToggle(m.id)}
            />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <details className="text-sm mt-1" open={guestSelected.length > 0}>
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
            Adicionar convidado de fora do squad
            {guestSelected.length > 0 && (
              <span className="ml-1 text-foreground">({guestSelected.length})</span>
            )}
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {others.map((m) => (
              <MemberChip
                key={m.id}
                member={m}
                selected={memberIds.has(m.id)}
                onToggle={() => onToggle(m.id)}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
