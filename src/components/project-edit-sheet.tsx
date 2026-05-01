"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import { createClient } from "@/lib/supabase/client";
import { roleLabel } from "@/lib/roles";
import { showErrorToast } from "@/lib/optimistic/toast";

type ClientOption = { id: string; name: string };
type MemberOption = { id: string; name: string; role: string };

export type ProjectEditInitial = {
  id: string;
  name: string;
  repoUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  clientId: string;
  pmId: string | null;
  githubRepoOwner: string | null;
  githubRepoName: string | null;
  githubDefaultBranch: string | null;
  memberIds: string[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectEditInitial | null;
  onSaved: () => void;
};

export function ProjectEditSheet({
  open,
  onOpenChange,
  project,
  onSaved,
}: Props) {
  const isMobile = useIsMobile();
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [allMembers, setAllMembers] = useState<MemberOption[]>([]);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    repoUrl: "",
    startDate: "",
    endDate: "",
    status: "active",
    clientId: "",
    pmId: "",
    githubRepoOwner: "",
    githubRepoName: "",
    githubDefaultBranch: "main",
    memberIds: [] as string[],
    ongoing: false,
  });

  useEffect(() => {
    if (!open || !project) return;
    const supabase = createClient();
    Promise.all([
      supabase.from("Client").select("id, name").order("name"),
      supabase.from("Member").select("id, name, role").order("name"),
    ]).then(([cRes, mRes]) => {
      if (cRes.data) setClients(cRes.data);
      if (mRes.data) setAllMembers(mRes.data as MemberOption[]);
    });

    setForm({
      name: project.name,
      repoUrl: project.repoUrl ?? "",
      startDate: project.startDate ? project.startDate.slice(0, 10) : "",
      endDate: project.endDate ? project.endDate.slice(0, 10) : "",
      status: project.status,
      clientId: project.clientId,
      pmId: project.pmId ?? "",
      githubRepoOwner: project.githubRepoOwner ?? "",
      githubRepoName: project.githubRepoName ?? "",
      githubDefaultBranch: project.githubDefaultBranch ?? "main",
      memberIds: project.memberIds,
      ongoing: !project.startDate && !project.endDate,
    });
  }, [open, project]);

  function toggleMember(memberId: string) {
    setForm((f) => ({
      ...f,
      memberIds: f.memberIds.includes(memberId)
        ? f.memberIds.filter((m) => m !== memberId)
        : [...f.memberIds, memberId],
    }));
  }

  async function save() {
    if (!project || saving) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const projectData = {
        name: form.name,
        repoUrl: form.repoUrl || null,
        startDate:
          form.ongoing || !form.startDate
            ? null
            : new Date(form.startDate).toISOString(),
        endDate:
          form.ongoing || !form.endDate
            ? null
            : new Date(form.endDate).toISOString(),
        status: form.status,
        clientId: form.clientId,
        pmId: form.pmId || null,
        githubRepoOwner: form.githubRepoOwner || null,
        githubRepoName: form.githubRepoName || null,
        githubDefaultBranch: form.githubDefaultBranch || "main",
        updatedAt: new Date().toISOString(),
      };

      const { error: pErr } = await supabase
        .from("Project")
        .update(projectData)
        .eq("id", project.id);
      if (pErr) {
        showErrorToast(new Error(pErr.message), {
          label: "Falha ao salvar projeto",
        });
        return;
      }

      const { data: existing } = await supabase
        .from("ProjectMember")
        .select("memberId")
        .eq("projectId", project.id);
      const existingIds = new Set((existing ?? []).map((m) => m.memberId));
      const nextIds = new Set(form.memberIds);

      const toRemove = Array.from(existingIds).filter((m) => !nextIds.has(m));
      const toAdd = Array.from(nextIds).filter((m) => !existingIds.has(m));

      if (toRemove.length > 0) {
        await supabase
          .from("ProjectMember")
          .delete()
          .eq("projectId", project.id)
          .in("memberId", toRemove);
      }
      if (toAdd.length > 0) {
        await supabase.from("ProjectMember").insert(
          toAdd.map((memberId) => ({
            id: crypto.randomUUID(),
            projectId: project.id,
            memberId,
            fpAllocation: 0,
          })),
        );
      }

      onOpenChange(false);
      onSaved();
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
          <h2 className="font-heading text-base font-medium">Editar Projeto</h2>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 grid gap-4">
          <div className="grid gap-2">
            <Label>Cliente</Label>
            <Select
              value={form.clientId}
              onValueChange={(v) =>
                v !== null && setForm((f) => ({ ...f, clientId: v }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione">
                  {(v: string | null) =>
                    v
                      ? clients.find((c) => c.id === v)?.name ?? "Selecione"
                      : "Selecione"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>PM Responsável</Label>
            <Select
              value={form.pmId}
              onValueChange={(v) =>
                v !== null && setForm((f) => ({ ...f, pmId: v }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione (opcional)">
                  {(v: string | null) =>
                    v
                      ? allMembers.find((m) => m.id === v)?.name ??
                        "Selecione (opcional)"
                      : "Selecione (opcional)"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {allMembers
                  .filter((m) => m.role === "pm")
                  .map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                {allMembers.filter((m) => m.role === "pm").length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Nenhum membro com role &quot;pm&quot; cadastrado
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Membros Alocados</Label>
            <p className="text-xs text-muted-foreground">
              Clique para alocar/desalocar membros do projeto
            </p>
            <div className="flex flex-wrap gap-1.5 p-3 border rounded-md min-h-[40px]">
              {allMembers
                .filter((m) => m.role !== "pm")
                .map((m) => {
                  const isSelected = form.memberIds.includes(m.id);
                  return (
                    <Badge
                      key={m.id}
                      variant={isSelected ? "default" : "outline"}
                      className={`cursor-pointer text-xs transition-colors ${
                        isSelected ? "" : "opacity-50 hover:opacity-80"
                      }`}
                      onClick={() => toggleMember(m.id)}
                    >
                      {m.name}
                      <span className="ml-1 text-[10px]">
                        {roleLabel(m.role)}
                      </span>
                    </Badge>
                  );
                })}
              {allMembers.filter((m) => m.role !== "pm").length === 0 && (
                <span className="text-xs text-muted-foreground">
                  Nenhum membro cadastrado
                </span>
              )}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Nome</Label>
            <Input
              value={form.name}
              onChange={(e) =>
                setForm((f) => ({ ...f, name: e.target.value }))
              }
            />
          </div>

          <div className="grid gap-2">
            <Label>Repo URL</Label>
            <Input
              value={form.repoUrl}
              onChange={(e) =>
                setForm((f) => ({ ...f, repoUrl: e.target.value }))
              }
              placeholder="https://github.com/..."
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label>GitHub Owner</Label>
              <Input
                value={form.githubRepoOwner}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    githubRepoOwner: e.target.value,
                  }))
                }
                placeholder="org-name"
              />
            </div>
            <div className="grid gap-2">
              <Label>GitHub Repo</Label>
              <Input
                value={form.githubRepoName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, githubRepoName: e.target.value }))
                }
                placeholder="repo-name"
              />
            </div>
            <div className="grid gap-2">
              <Label>Default Branch</Label>
              <Input
                value={form.githubDefaultBranch}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    githubDefaultBranch: e.target.value,
                  }))
                }
                placeholder="main"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={form.ongoing}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    ongoing: e.target.checked,
                    startDate: e.target.checked ? "" : f.startDate,
                    endDate: e.target.checked ? "" : f.endDate,
                  }))
                }
              />
              Projeto em andamento (sem prazo definido)
            </label>
            {!form.ongoing && (
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Data Início</Label>
                  <Input
                    type="date"
                    value={form.startDate}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, startDate: e.target.value }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Data Fim</Label>
                  <Input
                    type="date"
                    value={form.endDate}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, endDate: e.target.value }))
                    }
                  />
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <Label>Status</Label>
            <Select
              value={form.status}
              onValueChange={(v) =>
                v !== null && setForm((f) => ({ ...f, status: v }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="shrink-0 sticky bottom-0 border-t bg-popover px-6 py-3 pb-safe flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={save}
            disabled={saving || !form.name || !form.clientId}
          >
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
