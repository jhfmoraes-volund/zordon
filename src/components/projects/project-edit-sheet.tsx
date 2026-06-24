"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { Field, FormBody } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
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
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { parseDriveFolderId } from "@/lib/drive";
import { useAuth } from "@/contexts/auth-context";

type ClientOption = { id: string; name: string };
type MemberOption = { id: string; name: string; role: string; position: string | null };

/**
 * Kind do projeto (só na criação) — preset que define category/phase/cliente e
 * se um contrato é criado junto (D4). Interno = sem contrato (cliente Volund);
 * Proposta = contrato `proposed` + fase commercial; Contratado = contrato
 * `active` + fase immersion. Ver docs/runbooks/contract-allocation-ssot-runbook.md.
 */
type ProjectKind = "internal" | "proposal" | "contracted";

/** Data read-only derivada do contrato ativo (D2) — usada quando o projeto já tem contrato. */
function DerivedDate({ value }: { value: string }) {
  return (
    <div className="flex h-(--field-h) items-center gap-2 rounded-md border border-dashed bg-muted px-3 text-sm text-muted-foreground">
      <span>{value || "—"}</span>
      <span className="ml-auto text-[10px]">⤷ contrato</span>
    </div>
  );
}

const KIND_PRESET: Record<
  ProjectKind,
  { label: string; desc: string; category: string; phase: string }
> = {
  internal:   { label: "Interno",    desc: "Sem cliente externo, sem contrato.", category: "internal", phase: "ops" },
  proposal:   { label: "Proposta",   desc: "Comercial — cria contrato em proposta.", category: "billable", phase: "commercial" },
  contracted: { label: "Contratado", desc: "Engajamento ativo — contrato ativo.", category: "billable", phase: "immersion" },
};

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
  /** Opcional — call sites que não carregam o campo só não prefill. */
  driveFolderId?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` → criar novo projeto. */
  project: ProjectEditInitial | null;
  onSaved: () => void;
};

const EMPTY_FORM = {
  kind: "proposal" as ProjectKind,
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
  driveFolder: "",
};

/**
 * Editor único de projeto (criar + editar). Side sheet no desktop, bottom no
 * mobile. A equipe é READ-ONLY (F2.9): roster é derivado das alocações de
 * contrato (`finance.labor_allocation` → `v_project_team`), escrito só no app
 * Finanças (admin). O sheet não escreve mais `ProjectMember`.
 */
function formFromProject(project: ProjectEditInitial | null): typeof EMPTY_FORM {
  if (!project) return EMPTY_FORM;
  return {
    kind: "contracted" as ProjectKind, // irrelevante na edição (selector só aparece na criação)
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
    driveFolder: project.driveFolderId ?? "",
  };
}

export function ProjectEditSheet({ open, onOpenChange, project, onSaved }: Props) {
  const { member } = useAuth();
  const router = useRouter();
  // Handoff pós-criação: pergunta se quer configurar contrato/equipe no S&OP.
  const [handoff, setHandoff] = useState<ConfirmState | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  // Equipe derivada (read-only) — roster canônico via /api/projects/[id]/members
  // (getProjectTeam → v_project_team). Só na edição; criação ainda não tem roster.
  const [team, setTeam] = useState<
    { id: string; name: string | null; role: string | null }[]
  >([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  // Editar: datas/engajamento são read-through do contrato (D2). Saber se há
  // contrato decide se travamos esses campos. Criação não tem contrato ainda.
  const [hasContract, setHasContract] = useState(false);
  const datesLocked = Boolean(project) && hasContract;

  // Reseta o form quando o sheet abre (criar) ou troca de projeto (editar).
  // Padrão "adjust state during render" do React — evita setState em effect.
  const formKey = open ? project?.id ?? "new" : null;
  const [prevFormKey, setPrevFormKey] = useState<string | null>(null);
  if (formKey !== prevFormKey) {
    setPrevFormKey(formKey);
    setForm(formFromProject(project));
    setHasContract(false); // reabre limpo; o effect reconfirma na edição
    setTeam([]); // equipe derivada recarrega no effect quando há projeto
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

  // Editar: descobre se o projeto já tem contrato (→ datas viram read-only).
  useEffect(() => {
    if (!open || !project) return; // reset já acontece no bloco de render acima
    let alive = true;
    fetchOrThrow(`/api/finance/contract-period?projectId=${project.id}`)
      .then((r) => r.json())
      .then((d: { periods?: unknown[] }) => {
        if (alive) setHasContract((d.periods?.length ?? 0) > 0);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, project]);

  // Editar: carrega a equipe derivada (read-only) da fonte canônica.
  useEffect(() => {
    if (!open || !project) return; // reset acontece no bloco de render acima
    let alive = true;
    fetchOrThrow(`/api/projects/${project.id}/members`)
      .then((r) => r.json())
      .then((rows: { id: string; name: string | null; role: string | null }[]) => {
        if (alive) setTeam(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, project]);

  /** Preset de kind (só criação): define category/phase e, p/ interno, cliente Volund. */
  function applyKind(kind: ProjectKind) {
    const preset = KIND_PRESET[kind];
    const volundId = clients.find((c) => c.name === "Volund")?.id ?? "";
    setForm((f) => ({
      ...f,
      kind,
      category: preset.category,
      phase: preset.phase,
      clientId: kind === "internal" ? volundId : f.clientId === volundId ? "" : f.clientId,
    }));
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const supabase = createClient();

      // Drive: aceita URL ou ID; persiste só o folder ID. driveLinkedBy = quem
      // configurou (o connected account dele executa o sync — ver runbook D3).
      const driveInput = form.driveFolder.trim();
      const parsedDriveFolderId = driveInput ? parseDriveFolderId(driveInput) : null;
      if (driveInput && !parsedDriveFolderId) {
        showErrorToast(new Error("URL/ID da pasta do Drive inválido"), {
          label: "Pasta do Google Drive",
        });
        return;
      }
      const driveChanged = parsedDriveFolderId !== (project?.driveFolderId ?? null);

      const projectData = {
        name: form.name,
        repoUrl: form.repoUrl || null,
        startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
        endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
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
        ...(driveChanged
          ? {
              driveFolderId: parsedDriveFolderId,
              driveLinkedBy: parsedDriveFolderId ? member?.id ?? null : null,
            }
          : {}),
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

      // Equipe NÃO é escrita aqui (F2.9): roster = alocações de contrato
      // (admin, app Finanças). O sheet não toca mais ProjectMember.

      // Kind proposal/contracted (só criação): cria um contrato STUB já linkado
      // (D1/D4) — vigência/billing/valor são configurados depois no S&OP, não aqui
      // (sem duplicação). Interno não tem contrato. Contrato é admin-only.
      const isNewBillable = !project && form.kind !== "internal";
      let createdContract = false;
      if (isNewBillable) {
        const today = new Date().toISOString().slice(0, 10);
        try {
          await fetchOrThrow("/api/finance/contract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              label: "Contrato 1",
              status: form.kind === "proposal" ? "proposed" : "active",
              billingType: "squad", // placeholder; admin ajusta no S&OP
              effectiveFrom: today,
              effectiveTo: null,
            }),
          });
          createdContract = true;
        } catch (e) {
          showErrorToast(e, { label: "Projeto criado, mas o contrato falhou" });
        }
      }

      onOpenChange(false);
      onSaved();

      // Handoff: leva o admin pro S&OP pra configurar contrato + equipe (modal
      // simples). Só pra projeto novo com contrato; interno/edição fecham direto.
      if (isNewBillable && createdContract && projectId) {
        const pid = projectId;
        setHandoff({
          title: "Projeto criado",
          description:
            "Falta configurar vigência, valor e equipe no S&OP (Finanças). Quer ir agora?",
          confirmLabel: "Configurar no S&OP",
          cancelLabel: "Depois",
          // Abre o projeto direto no app Finanças (S&OP) do Overview via ?fp=.
          onConfirm: () => router.push(`/?tab=apps&app=finance&fp=${pid}`),
        });
      }
    } finally {
      setSaving(false);
    }
  }

  const pmEligible = members.filter((m) => isPmEligible(m.position));

  return (
    <>
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>{project ? "Editar Projeto" : "Novo Projeto"}</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody>
          <FormBody>
            {!project && (
              <Field name="project-kind" required>
                <Field.Label>Tipo de projeto</Field.Label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(KIND_PRESET) as ProjectKind[]).map((k) => {
                    const p = KIND_PRESET[k];
                    const selected = form.kind === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => applyKind(k)}
                        className={`flex flex-col gap-1 rounded-lg border p-2.5 text-left transition-colors ${
                          selected
                            ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                            : "hover:border-foreground/20"
                        }`}
                      >
                        <span className="text-xs font-semibold">{p.label}</span>
                        <span className="text-[10px] leading-tight text-muted-foreground">{p.desc}</span>
                      </button>
                    );
                  })}
                </div>
                <Field.Hint>
                  {form.kind === "internal"
                    ? "Cliente Volund, sem contrato."
                    : form.kind === "proposal"
                      ? "Cria um contrato em Proposta — vigência, valor e equipe são configurados no S&OP."
                      : "Cria um contrato Ativo — vigência, valor e equipe são configurados no S&OP."}
                </Field.Hint>
              </Field>
            )}

            <Field name="project-name" required>
              <Field.Label>Nome</Field.Label>
              <Field.Control>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field.Control>
            </Field>

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

            <Field name="project-drive-folder">
              <Field.Label>Pasta do Google Drive</Field.Label>
              <Field.Control>
                <Input
                  value={form.driveFolder}
                  onChange={(e) => setForm({ ...form, driveFolder: e.target.value })}
                  placeholder="https://drive.google.com/drive/folders/... ou ID"
                />
              </Field.Control>
              <Field.Hint>
                Aba Drive lista os arquivos desta pasta. Quem salvar vira o dono do sync.
              </Field.Hint>
            </Field>

            {/* Criação = enxuto (identidade). Contrato, datas, equipe e infra
                vivem no S&OP (Finanças) — só aparecem na EDIÇÃO, read-through. */}
            {project && (
              <>
            <Field name="project-team">
              <Field.Label>Equipe</Field.Label>
              <Field.Hint>
                PM (gestor) + builders alocados. Read-only — aloque no app Finanças (S&OP).
              </Field.Hint>
              <div className="flex min-h-[40px] flex-wrap gap-1.5 rounded-md border bg-muted/30 p-3">
                {team.length > 0 ? (
                  team.map((m) => (
                    <Badge key={m.id} variant="outline" className="text-xs">
                      {m.name ?? "—"}
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        {roleLabel(m.role)}
                      </span>
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Sem equipe alocada ainda — aloque no app Finanças.
                  </span>
                )}
              </div>
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
                    onValueChange={(v) => setForm({ ...form, engagementType: v })}
                    disabled={datesLocked}
                  />
                </Field.Control>
                <Field.Hint>
                  {datesLocked
                    ? "Derivado do contrato ativo — edite a vigência/billing em Finanças."
                    : "Squad as a Service = faturamento recorrente (data de fim = renovação); Por encomenda = faturado por PFV entregue."}
                </Field.Hint>
              </Field>
              <Field.Row cols={2}>
                <Field name="project-start">
                  <Field.Label>Data Início</Field.Label>
                  <Field.Control>
                    {datesLocked ? (
                      <DerivedDate value={form.startDate} />
                    ) : (
                      <DatePicker
                        data-slot="button"
                        clearable
                        value={form.startDate}
                        onChange={(iso) => setForm({ ...form, startDate: iso })}
                      />
                    )}
                  </Field.Control>
                </Field>
                <Field name="project-end">
                  <Field.Label>
                    {form.engagementType === "continuous" ? "Renovação" : "Estimativa de fim"}
                  </Field.Label>
                  <Field.Control>
                    {datesLocked ? (
                      <DerivedDate value={form.endDate} />
                    ) : (
                      <DatePicker
                        data-slot="button"
                        clearable
                        value={form.endDate}
                        onChange={(iso) => setForm({ ...form, endDate: iso })}
                      />
                    )}
                  </Field.Control>
                </Field>
              </Field.Row>
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
              </>
            )}
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
      <ConfirmDialog state={handoff} onClose={() => setHandoff(null)} />
    </>
  );
}
