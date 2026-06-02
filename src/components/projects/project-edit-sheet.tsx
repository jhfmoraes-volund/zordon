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
import { Badge } from "@/components/ui/badge";
import { Field, FormBody } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChipSelect } from "@/components/ui/status-chip-select";
import { PROJECT_STATUS, PROJECT_CATEGORY, PROJECT_PHASE, PROJECT_ENGAGEMENT } from "@/lib/status-chips";
import { createClient } from "@/lib/supabase/client";
import { isPmEligible, roleLabel } from "@/lib/roles";
import { generateUniqueReferenceKey } from "@/lib/project-reference-key";
import { showErrorToast } from "@/lib/optimistic/toast";

type ClientOption = { id: string; name: string };
type MemberOption = { id: string; name: string; role: string; position: string | null };

/** Forma de entrada na edição. `null` em `project` → modo criação. */
export type ProjectEditInitial = {
  id: string;
  name: string;
  repoUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  category: string;
  phase: string;
  engagementType: string;
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
  /** `null` → criar novo projeto. */
  project: ProjectEditInitial | null;
  onSaved: () => void;
};

const EMPTY_FORM = {
  name: "",
  repoUrl: "",
  startDate: "",
  endDate: "",
  status: "active",
  category: "billable",
  phase: "ops",
  engagementType: "fixed_scope",
  clientId: "",
  pmId: "",
  githubRepoOwner: "",
  githubRepoName: "",
  githubDefaultBranch: "main",
  memberIds: [] as string[],
};

/**
 * Editor único de projeto (criar + editar). Side sheet no desktop, bottom no
 * mobile. Sincroniza membros por delta — preserva `fpAllocation` dos que ficam.
 */
function formFromProject(project: ProjectEditInitial | null): typeof EMPTY_FORM {
  if (!project) return EMPTY_FORM;
  return {
    name: project.name,
    repoUrl: project.repoUrl ?? "",
    startDate: project.startDate ? project.startDate.slice(0, 10) : "",
    endDate: project.endDate ? project.endDate.slice(0, 10) : "",
    status: project.status,
    category: project.category || "billable",
    phase: project.phase || "ops",
    engagementType: project.engagementType || "fixed_scope",
    clientId: project.clientId,
    pmId: project.pmId ?? "",
    githubRepoOwner: project.githubRepoOwner ?? "",
    githubRepoName: project.githubRepoName ?? "",
    githubDefaultBranch: project.githubDefaultBranch ?? "main",
    memberIds: project.memberIds,
  };
}

export function ProjectEditSheet({ open, onOpenChange, project, onSaved }: Props) {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  // Reseta o form quando o sheet abre (criar) ou troca de projeto (editar).
  // Padrão "adjust state during render" do React — evita setState em effect.
  const formKey = open ? project?.id ?? "new" : null;
  const [prevFormKey, setPrevFormKey] = useState<string | null>(null);
  if (formKey !== prevFormKey) {
    setPrevFormKey(formKey);
    setForm(formFromProject(project));
  }

  // Carrega clientes/membros (sistema externo) quando abre.
  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    Promise.all([
      supabase.from("Client").select("id, name").order("name"),
      supabase.from("Member").select("id, name, role, position").eq("isGuest", false).order("name"),
    ]).then(([cRes, mRes]) => {
      if (cRes.data) setClients(cRes.data);
      if (mRes.data) setMembers(mRes.data as MemberOption[]);
    });
  }, [open]);

  function toggleMember(memberId: string) {
    setForm((f) => ({
      ...f,
      memberIds: f.memberIds.includes(memberId)
        ? f.memberIds.filter((m) => m !== memberId)
        : [...f.memberIds, memberId],
    }));
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const isContinuous = form.engagementType === "continuous";
      const projectData = {
        name: form.name,
        repoUrl: form.repoUrl || null,
        startDate: isContinuous || !form.startDate ? null : new Date(form.startDate).toISOString(),
        endDate: isContinuous || !form.endDate ? null : new Date(form.endDate).toISOString(),
        status: form.status,
        category: form.category,
        phase: form.phase,
        engagementType: form.engagementType,
        clientId: form.clientId,
        pmId: form.pmId || null,
        githubRepoOwner: form.githubRepoOwner || null,
        githubRepoName: form.githubRepoName || null,
        githubDefaultBranch: form.githubDefaultBranch || "main",
        updatedAt: new Date().toISOString(),
      };

      let projectId: string;
      if (project) {
        const { error } = await supabase.from("Project").update(projectData).eq("id", project.id);
        if (error) {
          showErrorToast(new Error(error.message), { label: "Falha ao salvar projeto" });
          return;
        }
        projectId = project.id;
      } else {
        const referenceKey = await generateUniqueReferenceKey(supabase, form.name);
        const { data, error } = await supabase
          .from("Project")
          .insert({ id: crypto.randomUUID(), referenceKey, ...projectData })
          .select("id")
          .single();
        if (error || !data) {
          showErrorToast(new Error(error?.message ?? "Falha ao criar projeto"), { label: "Projeto" });
          return;
        }
        projectId = data.id;
      }

      // Sync de membros por delta — preserva fpAllocation dos que permanecem.
      const { data: existing } = await supabase
        .from("ProjectMember")
        .select("memberId")
        .eq("projectId", projectId);
      const existingIds = new Set((existing ?? []).map((m) => m.memberId));
      const nextIds = new Set(form.memberIds);
      const toRemove = [...existingIds].filter((m) => !nextIds.has(m));
      const toAdd = [...nextIds].filter((m) => !existingIds.has(m));

      if (toRemove.length > 0) {
        await supabase
          .from("ProjectMember")
          .delete()
          .eq("projectId", projectId)
          .in("memberId", toRemove);
      }
      if (toAdd.length > 0) {
        await supabase.from("ProjectMember").insert(
          toAdd.map((memberId) => ({
            id: crypto.randomUUID(),
            projectId,
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

  const pmEligible = members.filter((m) => isPmEligible(m.position));
  const allocatable = members.filter((m) => !isPmEligible(m.position));

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>{project ? "Editar Projeto" : "Novo Projeto"}</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody>
          <FormBody>
            <Field name="project-client" required>
              <Field.Label>Cliente</Field.Label>
              <Field.Control>
                <Select
                  value={form.clientId}
                  onValueChange={(v) => v && setForm({ ...form, clientId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione">
                      {(value: string | null) =>
                        clients.find((c) => c.id === value)?.name ?? "Selecione"
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
              </Field.Control>
            </Field>

            <Field name="project-pm">
              <Field.Label>PM Responsável</Field.Label>
              <Field.Control>
                <Select
                  value={form.pmId}
                  onValueChange={(v) => v && setForm({ ...form, pmId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione (opcional)">
                      {(value: string | null) =>
                        members.find((m) => m.id === value)?.name ?? "Selecione (opcional)"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {pmEligible.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                    {pmEligible.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        Nenhum membro elegível a PM cadastrado
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </Field.Control>
            </Field>

            <Field name="project-members">
              <Field.Label>Membros Alocados</Field.Label>
              <Field.Hint>Clique para alocar/desalocar membros do projeto</Field.Hint>
              <div className="flex min-h-[40px] flex-wrap gap-1.5 rounded-md border p-3">
                {allocatable.map((m) => {
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
                      <span className="ml-1 text-[10px]">{roleLabel(m.position)}</span>
                    </Badge>
                  );
                })}
                {allocatable.length === 0 && (
                  <span className="text-xs text-muted-foreground">Nenhum membro cadastrado</span>
                )}
              </div>
            </Field>

            <Field name="project-name" required>
              <Field.Label>Nome</Field.Label>
              <Field.Control>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field.Control>
            </Field>

            <Field name="project-repo">
              <Field.Label>Repo URL</Field.Label>
              <Field.Control>
                <Input
                  value={form.repoUrl}
                  onChange={(e) => setForm({ ...form, repoUrl: e.target.value })}
                  placeholder="https://github.com/..."
                />
              </Field.Control>
            </Field>

            <Field.Row cols={3}>
              <Field name="project-gh-owner">
                <Field.Label>GitHub Owner</Field.Label>
                <Field.Control>
                  <Input
                    value={form.githubRepoOwner}
                    onChange={(e) => setForm({ ...form, githubRepoOwner: e.target.value })}
                    placeholder="org-name"
                  />
                </Field.Control>
              </Field>
              <Field name="project-gh-repo">
                <Field.Label>GitHub Repo</Field.Label>
                <Field.Control>
                  <Input
                    value={form.githubRepoName}
                    onChange={(e) => setForm({ ...form, githubRepoName: e.target.value })}
                    placeholder="repo-name"
                  />
                </Field.Control>
              </Field>
              <Field name="project-gh-branch">
                <Field.Label>Default Branch</Field.Label>
                <Field.Control>
                  <Input
                    value={form.githubDefaultBranch}
                    onChange={(e) => setForm({ ...form, githubDefaultBranch: e.target.value })}
                    placeholder="main"
                  />
                </Field.Control>
              </Field>
            </Field.Row>

            <div className="flex flex-col gap-(--field-gap)">
              <Field name="project-engagement">
                <Field.Label>Tipo de engajamento</Field.Label>
                <Field.Control>
                  <StatusChipSelect
                    variant="input"
                    value={form.engagementType}
                    options={PROJECT_ENGAGEMENT}
                    onValueChange={(v) =>
                      setForm({
                        ...form,
                        engagementType: v,
                        startDate: v === "continuous" ? "" : form.startDate,
                        endDate: v === "continuous" ? "" : form.endDate,
                      })
                    }
                  />
                </Field.Control>
                <Field.Hint>Contínuo = sem fim previsto; com fim = tem data estimada de encerramento.</Field.Hint>
              </Field>
              {form.engagementType !== "continuous" && (
                <Field.Row cols={2}>
                  <Field name="project-start">
                    <Field.Label>Data Início</Field.Label>
                    <Field.Control>
                      <Input
                        type="date"
                        value={form.startDate}
                        onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                      />
                    </Field.Control>
                  </Field>
                  <Field name="project-end">
                    <Field.Label>Estimativa de fim</Field.Label>
                    <Field.Control>
                      <Input
                        type="date"
                        value={form.endDate}
                        onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                      />
                    </Field.Control>
                  </Field>
                </Field.Row>
              )}
            </div>

            <Field.Row cols={3}>
              <Field name="project-status">
                <Field.Label>Status</Field.Label>
                <Field.Control>
                  <StatusChipSelect
                    variant="input"
                    value={form.status}
                    options={PROJECT_STATUS}
                    onValueChange={(v) => setForm({ ...form, status: v })}
                  />
                </Field.Control>
              </Field>

              <Field name="project-phase">
                <Field.Label>Fase</Field.Label>
                <Field.Control>
                  <StatusChipSelect
                    variant="input"
                    value={form.phase}
                    options={PROJECT_PHASE}
                    onValueChange={(v) => setForm({ ...form, phase: v })}
                  />
                </Field.Control>
              </Field>

              <Field name="project-category">
                <Field.Label>Categoria</Field.Label>
                <Field.Control>
                  <StatusChipSelect
                    variant="input"
                    value={form.category}
                    options={PROJECT_CATEGORY}
                    onValueChange={(v) => setForm({ ...form, category: v })}
                  />
                </Field.Control>
                <Field.Hint>Billable fatura; interno/não-billable saem do faturável.</Field.Hint>
              </Field>
            </Field.Row>
          </FormBody>
        </ResponsiveSheetBody>

        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || !form.name || !form.clientId}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
