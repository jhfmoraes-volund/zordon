"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Plus, X } from "lucide-react";
import { showErrorToast } from "@/lib/optimistic/toast";

type Member = { id: string; name: string; role: string };
type Project = { id: string; name: string; status: string };
type Sprint = { id: string; name: string; status: string; projectId: string };
type ExternalAttendee = { name: string; email: string; role: string };

type MeetingType = "pm_review" | "general" | "daily" | "super_planning";

const TYPE_DESCRIPTIONS: Record<MeetingType, string> = {
  pm_review:
    "Selecione 1 ou mais PMs participantes. Os projetos ativos de cada PM serão revisados (próximos passos, saudabilidade, pontos de atenção, OBS) e ações pendentes da última reunião concluída serão trazidas.",
  general:
    "Reunião sem revisão estruturada. Você pode juntar projetos relacionados (opcional) e registrar pontos de ação.",
  daily:
    "Daily de um ou mais projetos. Discuta progresso, blockers e plano de ação sobre as tasks da sprint atual.",
  super_planning:
    "Planejamento da sprint atual de um projeto (segundas-feiras). Sugestões de IA + aprovação manual de criação/edição/movimentação de tasks.",
};

export default function NewMeetingPage() {
  const router = useRouter();
  const [type, setType] = useState<MeetingType>("pm_review");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);

  const [pmIds, setPmIds] = useState<Set<string>>(new Set());
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [projectIds, setProjectIds] = useState<Set<string>>(new Set());
  const [externals, setExternals] = useState<ExternalAttendee[]>([]);
  const [extName, setExtName] = useState("");
  const [extEmail, setExtEmail] = useState("");
  const [extRole, setExtRole] = useState("");

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase.from("Member").select("id, name, role").order("name"),
      supabase.from("Project").select("id, name, status").eq("status", "active").order("name"),
      supabase.from("Sprint").select("id, name, status, projectId").eq("status", "active"),
    ]).then(([m, p, s]) => {
      setMembers((m.data ?? []) as Member[]);
      setProjects((p.data ?? []) as Project[]);
      setSprints((s.data ?? []) as Sprint[]);
    });
  }, []);

  const pms = members.filter((m) => m.role === "pm");

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
  const toggleProject = toggleInSet(setProjectIds);

  // Super Planning aceita só um projeto — radio behavior
  const selectSingleProject = (id: string) => {
    setProjectIds(new Set([id]));
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

  // Reset quando muda de tipo (evita carregar seleções incompatíveis)
  const switchType = (next: MeetingType) => {
    setType(next);
    setProjectIds(new Set());
    setPmIds(new Set());
    setMemberIds(new Set());
    setExternals([]);
    setTitle("");
  };

  const canSubmit = () => {
    if (!date) return false;
    if (type === "pm_review") return pmIds.size > 0;
    if (type === "daily") return projectIds.size > 0;
    if (type === "super_planning") {
      if (projectIds.size !== 1) return false;
      // valida que tem sprint ativa
      const pid = Array.from(projectIds)[0];
      return sprints.some((s) => s.projectId === pid);
    }
    return title.trim().length > 0 && (memberIds.size > 0 || externals.length > 0);
  };

  const create = async () => {
    setSaving(true);
    try {
      let attendees;
      if (type === "pm_review") {
        attendees = Array.from(pmIds).map((id) => ({ memberId: id, role: "pm" }));
      } else if (type === "daily" || type === "super_planning") {
        attendees = Array.from(memberIds).map((id) => ({ memberId: id, role: "attendee" }));
      } else {
        attendees = [
          ...Array.from(memberIds).map((id) => ({ memberId: id, role: "attendee" })),
          ...externals.map((e) => ({
            externalName: e.name,
            externalEmail: e.email || null,
            externalRole: e.role || null,
            role: "external",
          })),
        ];
      }

      const body = {
        type,
        date: `${date}T12:00:00`,
        title: title.trim() || null,
        notes: notes.trim() || null,
        pmMemberIds: type === "pm_review" ? Array.from(pmIds) : [],
        attendees,
        projectIds: ["general", "daily", "super_planning"].includes(type)
          ? Array.from(projectIds)
          : [],
      };

      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error("Erro ao criar reunião:", err);
        let msg = "Erro ao criar reunião.";
        try {
          const parsed = JSON.parse(err);
          if (parsed?.error) msg = parsed.error;
        } catch {}
        showErrorToast(new Error(msg), { label: "Criar reunião" });
        return;
      }
      const meeting = await res.json();
      router.push(`/meetings/${meeting.id}`);
    } catch (e) {
      console.error("Erro ao criar reunião:", e);
      showErrorToast(e, { label: "Criar reunião" });
    } finally {
      setSaving(false);
    }
  };

  const showProjectPicker = type === "daily" || type === "super_planning" || type === "general";
  const showMemberPicker = type === "general" || type === "daily" || type === "super_planning";
  const showExternalsPicker = type === "general";
  const showTitleField = type === "general";
  const showPmPicker = type === "pm_review";

  // Super Planning: avisa se projeto não tem sprint ativa
  const selectedProjectId = type === "super_planning" ? Array.from(projectIds)[0] : null;
  const selectedProjectHasSprint = selectedProjectId
    ? sprints.some((s) => s.projectId === selectedProjectId)
    : true;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/meetings">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Nova Reunião</h1>
      </div>

      {/* Type toggle */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={type === "pm_review" ? "default" : "outline"}
          onClick={() => switchType("pm_review")}
        >
          Reunião com PMs
        </Button>
        <Button
          variant={type === "general" ? "default" : "outline"}
          onClick={() => switchType("general")}
        >
          Reunião geral
        </Button>
        <Button
          variant={type === "daily" ? "default" : "outline"}
          onClick={() => switchType("daily")}
        >
          Daily
        </Button>
        <Button
          variant={type === "super_planning" ? "default" : "outline"}
          onClick={() => switchType("super_planning")}
        >
          Super Planning
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">{TYPE_DESCRIPTIONS[type]}</p>

      <div className="grid gap-4">
        <div className="grid gap-2 max-w-xs">
          <Label>Data da reunião</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {showTitleField && (
          <div className="grid gap-2">
            <Label>Título</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Alinhamento com cliente, Planejamento Q3..."
            />
          </div>
        )}

        {showPmPicker && (
          <div className="grid gap-2">
            <Label>PMs participantes</Label>
            <div className="flex flex-wrap gap-2">
              {pms.length === 0 && (
                <span className="text-sm text-muted-foreground">Nenhum PM cadastrado.</span>
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
          </div>
        )}

        {showProjectPicker && (
          <div className="grid gap-2">
            <Label>
              {type === "super_planning"
                ? "Projeto (1)"
                : type === "daily"
                  ? "Projetos (1+)"
                  : "Projetos vinculados (opcional)"}
            </Label>
            <div className="flex flex-wrap gap-2">
              {projects.length === 0 && (
                <span className="text-sm text-muted-foreground">Nenhum projeto ativo.</span>
              )}
              {projects.map((p) => {
                const selected = projectIds.has(p.id);
                const hasSprint = sprints.some((s) => s.projectId === p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      type === "super_planning" ? selectSingleProject(p.id) : toggleProject(p.id)
                    }
                    className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
                      selected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-accent"
                    }`}
                  >
                    {p.name}
                    {type === "super_planning" && !hasSprint && (
                      <span className="ml-1 text-xs opacity-70">(sem sprint ativa)</span>
                    )}
                  </button>
                );
              })}
            </div>
            {type === "super_planning" && selectedProjectId && !selectedProjectHasSprint && (
              <p className="text-xs text-destructive">
                Esse projeto não tem sprint ativa. Crie ou ative uma sprint antes.
              </p>
            )}
          </div>
        )}

        {showMemberPicker && (
          <div className="grid gap-2">
            <Label>
              {type === "general"
                ? "Membros participantes"
                : "Participantes (opcional)"}
            </Label>
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
          </div>
        )}

        {showExternalsPicker && (
          <div className="grid gap-2">
            <Label>Externos (opcional)</Label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:flex-wrap">
              <div className="grid gap-1 w-full sm:flex-1 sm:min-w-[140px]">
                <Label className="text-xs text-muted-foreground">Nome</Label>
                <Input value={extName} onChange={(e) => setExtName(e.target.value)} placeholder="Nome" />
              </div>
              <div className="grid gap-1 w-full sm:flex-1 sm:min-w-[160px]">
                <Label className="text-xs text-muted-foreground">E-mail</Label>
                <Input value={extEmail} onChange={(e) => setExtEmail(e.target.value)} placeholder="email@..." />
              </div>
              <div className="grid gap-1 w-full sm:flex-1 sm:min-w-[120px]">
                <Label className="text-xs text-muted-foreground">Cargo</Label>
                <Input value={extRole} onChange={(e) => setExtRole(e.target.value)} placeholder="Cargo" />
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
                    {e.role && <span className="text-xs text-muted-foreground">({e.role})</span>}
                    <button type="button" onClick={() => removeExternal(i)} className="hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

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

      <div className="flex gap-2 sticky bottom-0 -mx-3 px-3 py-3 bg-background border-t pb-safe sm:static sm:mx-0 sm:px-0 sm:py-0 sm:border-0 sm:pb-0">
        <Button onClick={create} disabled={!canSubmit() || saving} className="flex-1 sm:flex-initial">
          {saving ? "Criando..." : "Criar reunião"}
        </Button>
        <Link href="/meetings" className="flex-1 sm:flex-initial">
          <Button variant="outline" className="w-full sm:w-auto">
            Cancelar
          </Button>
        </Link>
      </div>
    </div>
  );
}
