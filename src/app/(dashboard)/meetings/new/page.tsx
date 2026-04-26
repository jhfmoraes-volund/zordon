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

type Member = { id: string; name: string; role: string };
type Project = { id: string; name: string; status: string };
type ExternalAttendee = { name: string; email: string; role: string };

type MeetingType = "pm_review" | "general";

export default function NewMeetingPage() {
  const router = useRouter();
  const [type, setType] = useState<MeetingType>("pm_review");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

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
    ]).then(([m, p]) => {
      setMembers((m.data ?? []) as Member[]);
      setProjects((p.data ?? []) as Project[]);
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

  const canSubmit = () => {
    if (!date) return false;
    if (type === "pm_review") return pmIds.size > 0;
    return title.trim().length > 0 && (memberIds.size > 0 || externals.length > 0);
  };

  const create = async () => {
    setSaving(true);
    try {
      const attendees =
        type === "pm_review"
          ? Array.from(pmIds).map((id) => ({ memberId: id, role: "pm" }))
          : [
              ...Array.from(memberIds).map((id) => ({ memberId: id, role: "attendee" })),
              ...externals.map((e) => ({
                externalName: e.name,
                externalEmail: e.email || null,
                externalRole: e.role || null,
                role: "external",
              })),
            ];

      const body = {
        type,
        date: `${date}T12:00:00`,
        title: title.trim() || null,
        notes: notes.trim() || null,
        pmMemberIds: type === "pm_review" ? Array.from(pmIds) : [],
        attendees,
        projectIds: type === "general" ? Array.from(projectIds) : [],
      };

      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error("Erro ao criar reunião:", err);
        alert("Erro ao criar reunião. Verifique o console.");
        return;
      }
      const meeting = await res.json();
      router.push(`/meetings/${meeting.id}`);
    } catch (e) {
      console.error("Erro ao criar reunião:", e);
      alert("Erro ao criar reunião.");
    } finally {
      setSaving(false);
    }
  };

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
      <div className="flex gap-2">
        <Button
          variant={type === "pm_review" ? "default" : "outline"}
          onClick={() => setType("pm_review")}
        >
          Reunião com PMs
        </Button>
        <Button
          variant={type === "general" ? "default" : "outline"}
          onClick={() => setType("general")}
        >
          Reunião geral
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        {type === "pm_review"
          ? "Selecione 1 ou mais PMs participantes. Os projetos ativos de cada PM serão revisados (próximos passos, saudabilidade, pontos de atenção, OBS) e ações pendentes da última reunião concluída serão trazidas."
          : "Reunião sem revisão estruturada. Você pode juntar projetos relacionados (opcional) e registrar pontos de ação."}
      </p>

      <div className="grid gap-4">
        <div className="grid gap-2 max-w-xs">
          <Label>Data da reunião</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {type === "general" && (
          <div className="grid gap-2">
            <Label>Título</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Alinhamento com cliente, Planejamento Q3..."
            />
          </div>
        )}

        {type === "pm_review" && (
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

        {type === "general" && (
          <>
            <div className="grid gap-2">
              <Label>Membros participantes</Label>
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
                        <span className="text-xs text-muted-foreground">({e.role})</span>
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

            <div className="grid gap-2">
              <Label>Projetos vinculados (opcional)</Label>
              <div className="flex flex-wrap gap-2">
                {projects.length === 0 && (
                  <span className="text-sm text-muted-foreground">
                    Nenhum projeto ativo.
                  </span>
                )}
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleProject(p.id)}
                    className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
                      projectIds.has(p.id)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-accent"
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          </>
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
        <Button
          onClick={create}
          disabled={!canSubmit() || saving}
          className="flex-1 sm:flex-initial"
        >
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
