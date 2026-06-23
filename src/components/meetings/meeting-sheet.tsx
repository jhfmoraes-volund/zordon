"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetBody,
  ResponsiveSheetFooter,
} from "@/components/ui/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { showErrorToast, fetchOrThrow } from "@/lib/optimistic/toast";
import { Plus, X, Download, Lock } from "lucide-react";
import { ImportMeetingModal } from "./import-meeting-modal";
import { ProjectPicker } from "@/components/projects/project-picker";
import { useAuth } from "@/contexts/auth-context";

type Member = { id: string; name: string };
type Project = { id: string; name: string; status: string };
type ExternalAttendee = { name: string; email: string; role: string };

const PUBLIC_KINDS = [
  { value: "general", label: "Geral" },
  { value: "one_on_one", label: "1:1" },
  { value: "sync", label: "Sync" },
  { value: "external", label: "Externa" },
] as const;

const LEGACY_KIND_LABELS: Record<string, string> = {
  pm_review: "PMs",
  daily: "Daily",
  planning: "Planning",
};

export type MeetingEditInitial = {
  id: string;
  visibility: "private" | "public";
  kind: string;
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
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  meeting?: MeetingEditInitial | null;
  defaultVisibility?: "private" | "public";
  onSaved: (meeting: { id: string }) => void;
};

export function MeetingSheet({
  open,
  onOpenChange,
  mode,
  meeting,
  defaultVisibility,
  onSaved,
}: Props) {
  const { member: currentMember } = useAuth();
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [visibility, setVisibility] = useState<"private" | "public">(
    defaultVisibility ?? "private"
  );
  const [kind, setKind] = useState<string>("general");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [projectIds, setProjectIds] = useState<Set<string>>(new Set());
  const [externals, setExternals] = useState<ExternalAttendee[]>([]);
  const [extName, setExtName] = useState("");
  const [extEmail, setExtEmail] = useState("");
  const [extRole, setExtRole] = useState("");

  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    Promise.all([
      supabase.from("Member").select("id, name").eq("isGuest", false).order("name"),
      supabase
        .from("Project")
        .select("id, name, status")
        .in("status", ["active", "paused"])
        .order("name"),
    ]).then(([m, p]) => {
      setMembers((m.data ?? []) as Member[]);
      setProjects((p.data ?? []) as Project[]);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && meeting) {
      setVisibility(meeting.visibility);
      setKind(meeting.kind);
      setDate(meeting.date.slice(0, 10));
      setTitle(meeting.title ?? "");
      setNotes(meeting.notes ?? "");
      const ids = new Set<string>();
      const exts: ExternalAttendee[] = [];
      for (const a of meeting.attendees) {
        if (a.memberId && a.role !== "owner") ids.add(a.memberId);
        if (a.externalName) {
          exts.push({
            name: a.externalName,
            email: a.externalEmail ?? "",
            role: a.externalRole ?? "",
          });
        }
      }
      setMemberIds(ids);
      setExternals(exts);
      setProjectIds(
        new Set(
          meeting.projectLinks
            .map((l) => l.project?.id)
            .filter(Boolean) as string[]
        )
      );
    } else {
      setVisibility(defaultVisibility ?? "private");
      setKind("general");
      setDate(new Date().toISOString().slice(0, 10));
      setTitle("");
      setNotes("");
      setMemberIds(new Set());
      setProjectIds(new Set());
      setExternals([]);
      setExtName("");
      setExtEmail("");
      setExtRole("");
    }
  }, [open, mode, meeting, defaultVisibility]);

  const switchVisibility = (v: "private" | "public") => {
    if (mode === "edit") return;
    setVisibility(v);
    setMemberIds(new Set());
    setExternals([]);
    setProjectIds(new Set());
    setTitle("");
  };

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

  const toggleMember = (id: string) =>
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canSubmit = () => !!date;

  function buildAttendees() {
    if (visibility === "private") {
      if (!currentMember?.id) return [];
      return [{ memberId: currentMember.id, role: "owner" }];
    }
    return [
      ...Array.from(memberIds).map((id) => ({ memberId: id, role: "attendee" })),
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
      const resolvedKind = visibility === "private" ? "general" : kind;
      if (mode === "create") {
        const body = {
          visibility,
          kind: resolvedKind,
          date: `${date}T12:00:00`,
          title: title.trim() || null,
          notes: notes.trim() || null,
          attendees: buildAttendees(),
          projectIds: Array.from(projectIds),
        };
        const res = await fetchOrThrow("/api/meetings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        onSaved(await res.json());
        onOpenChange(false);
      } else {
        if (!meeting) return;
        const body = {
          date: `${date}T12:00:00`,
          title: title.trim() || null,
          notes: notes.trim() || null,
          attendees: buildAttendees(),
          projectIds: Array.from(projectIds),
        };
        const res = await fetchOrThrow(`/api/meetings/${meeting.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        onSaved(await res.json());
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

  const isLegacyKind = mode === "edit" && LEGACY_KIND_LABELS[kind] !== undefined;

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle className="font-heading text-base font-medium">
            {mode === "create" ? "Nova Reunião" : "Editar Reunião"}
          </ResponsiveSheetTitle>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody className="space-y-4">
          {/* Visibilidade */}
          <div className="grid gap-2">
            <Label>
              Visibilidade
              {mode === "edit" && (
                <span className="text-xs text-muted-foreground ml-2">
                  (não pode ser alterada)
                </span>
              )}
            </Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={visibility === "private" ? "default" : "outline"}
                size="sm"
                disabled={mode === "edit"}
                onClick={() => switchVisibility("private")}
              >
                <Lock className="h-3 w-3 mr-1" />
                Privada
              </Button>
              <Button
                type="button"
                variant={visibility === "public" ? "default" : "outline"}
                size="sm"
                disabled={mode === "edit"}
                onClick={() => switchVisibility("public")}
              >
                Pública
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {visibility === "private"
                ? "Só você vê. Importe a transcrição do Granola; Alpha gera notes e To-dos. Vincular projetos permite que Alpha proponha Tasks."
                : "Todos os participantes marcados veem."}
            </p>
          </div>

          {/* Kind (só público) */}
          {visibility === "public" && (
            <div className="grid gap-2">
              <Label>
                Tipo
                {mode === "edit" && !isLegacyKind && (
                  <span className="text-xs text-muted-foreground ml-2">
                    (não pode ser alterado)
                  </span>
                )}
              </Label>
              {isLegacyKind ? (
                <div className="inline-flex w-fit items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1.5 text-sm text-muted-foreground">
                  {LEGACY_KIND_LABELS[kind]}
                  <span className="text-xs">(legado)</span>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {PUBLIC_KINDS.map((k) => (
                    <Button
                      key={k.value}
                      type="button"
                      variant={kind === k.value ? "default" : "outline"}
                      size="sm"
                      disabled={mode === "edit"}
                      onClick={() => setKind(k.value)}
                    >
                      {k.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Data */}
          <div className="grid gap-2 max-w-xs">
            <Label>Data da reunião</Label>
            <DatePicker value={date} onChange={setDate} />
          </div>

          {/* Título */}
          <div className="grid gap-2">
            <Label>Título</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Alinhamento com cliente, Planejamento Q3..."
            />
          </div>

          {/* Participantes (só público) */}
          {visibility === "public" && (
            <>
              <div className="grid gap-2">
                <Label>Participantes</Label>
                {members.length === 0 ? (
                  <span className="text-sm text-muted-foreground">
                    Carregando...
                  </span>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {members.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleMember(m.id)}
                        className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
                          memberIds.has(m.id)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background hover:bg-accent"
                        }`}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Externos */}
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
                    <Label className="text-xs text-muted-foreground">
                      E-mail
                    </Label>
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
            </>
          )}

          {/* Projetos */}
          <div className="grid gap-2">
            <Label>
              {visibility === "private"
                ? "Projetos pra propor Tasks (opcional)"
                : "Projetos vinculados (opcional)"}
            </Label>
            {visibility === "private" && (
              <p className="text-xs text-muted-foreground -mt-1">
                Se selecionar, Alpha pode propor Tasks nesses projetos a partir
                da transcrição. Você aprova depois.
              </p>
            )}
            <ProjectPicker
              mode="multi"
              available={projects.map((p) => ({
                id: p.id,
                name: p.name,
                hasActiveSprint: false,
              }))}
              selectedIds={Array.from(projectIds)}
              onChange={(ids) => setProjectIds(new Set(ids))}
              placeholder="Vincular projetos"
              emptyText="Nenhum projeto disponível"
            />
          </div>

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
        </ResponsiveSheetBody>

        <ResponsiveSheetFooter className="flex-wrap sm:items-center">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {mode === "create" && (
            <Button
              variant="outline"
              onClick={() => setImportOpen(true)}
              disabled={saving || !canSubmit()}
              title={
                visibility === "private"
                  ? "Cria a reunião privada a partir da transcrição do Granola"
                  : "Cria a reunião e deixa o Alpha popular a partir de uma transcrição"
              }
            >
              <Download className="h-4 w-4 mr-1" />
              {visibility === "private" ? "Importar do Granola" : "Importar reunião"}
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
        </ResponsiveSheetFooter>

        {mode === "create" && (
          <ImportMeetingModal
            open={importOpen}
            onOpenChange={setImportOpen}
            mode="create"
            visibility={visibility}
            kind={visibility === "private" ? "general" : kind}
            attendees={buildAttendees()}
            projectIds={Array.from(projectIds)}
          />
        )}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
