"use client";

import { useEffect, useState } from "react";
import { Wand2, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetDescription,
  ResponsiveSheetBody,
  ResponsiveSheetFooter,
} from "@/components/ui/responsive-sheet";
import { Field, FormBody } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  POSITIONS,
  POSITION_LABELS,
  positionLabel,
  MEMBER_ACCESS_LEVELS,
  ACCESS_LEVEL_LABELS,
  mapPositionToAccessLevel,
  type AccessLevel,
} from "@/lib/roles";
import { TOWERS, towerLabel } from "@/lib/memberSkills";
import type { MembersListItem } from "@/lib/members/members-load";

// ─── helpers ─────────────────────────────────────────────

const DEACTIVATION_REASON_LABELS: Record<string, string> = {
  terminated: "Desligado",
  left: "Saiu da empresa",
  other: "Outro",
};

function generatePassword(length = 14): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function errorFrom(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? `Erro ${res.status}`);
}

const NONE = "none"; // sentinela do Select pra "sem cargo / sem torre / sem contrato"

// ─── types ───────────────────────────────────────────────

type AllocRow = {
  key: string;
  projectId: string;
  fpAllocation: string;
  percent: string;
  effectiveFrom: string;
  allocationId: string | null;
};

type FormState = {
  name: string;
  email: string;
  isExternal: boolean;
  position: string; // "" = sem cargo
  createAccount: boolean;
  accessLevel: AccessLevel;
  password: string;
  specialty: string; // "" = sem torre
  githubUsername: string;
  fpCapacity: string;
};

function initialForm(member: MembersListItem | null): FormState {
  if (member) {
    return {
      name: member.name,
      email: member.email ?? "",
      isExternal: member.isExternal,
      position: member.position ?? "",
      createAccount: member.hasAccount,
      accessLevel: mapPositionToAccessLevel(member.position ?? member.role),
      password: "",
      specialty: member.specialty ?? "",
      githubUsername: member.githubUsername ?? "",
      fpCapacity: String(member.fpCapacity),
    };
  }
  return {
    name: "",
    email: "",
    isExternal: false,
    position: "product-builder",
    createAccount: true,
    accessLevel: "builder",
    password: generatePassword(),
    specialty: "",
    githubUsername: "",
    fpCapacity: "125",
  };
}

// ─── outer (controls open + remounts the form per session) ───

export function MemberEditSheet({
  open,
  onOpenChange,
  member,
  onSaved,
  isAdmin = false,
  onDeactivate,
  onReactivate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: MembersListItem | null;
  onSaved: () => void;
  isAdmin?: boolean;
  onDeactivate?: (member: MembersListItem) => void;
  onReactivate?: (member: MembersListItem) => void;
}) {
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="lg">
        {open && (
          // key remonta o form (estado fresco via initialForm) a cada abertura
          // ou troca de membro — sem effect de reset (React-recommended).
          <MemberEditForm
            key={member?.id ?? "new"}
            member={member}
            onOpenChange={onOpenChange}
            onSaved={onSaved}
            isAdmin={isAdmin}
            onDeactivate={onDeactivate}
            onReactivate={onReactivate}
          />
        )}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

// ─── inner form ───────────────────────────────────────────

function MemberEditForm({
  member,
  onOpenChange,
  onSaved,
  isAdmin,
  onDeactivate,
  onReactivate,
}: {
  member: MembersListItem | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  isAdmin: boolean;
  onDeactivate?: (member: MembersListItem) => void;
  onReactivate?: (member: MembersListItem) => void;
}) {
  const editing = !!member;

  const [form, setForm] = useState<FormState>(() => initialForm(member));
  const [allocs, setAllocs] = useState<AllocRow[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [loadingAlloc, setLoadingAlloc] = useState<boolean>(!!member);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carrega projetos + alocações uma vez na montagem. setState só após await
  // (sincronização com sistema externo), nunca síncrono no corpo do effect.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (member) {
        try {
          const res = await fetch(`/api/members/${member.id}/allocations`);
          if (!res.ok || cancelled) return;
          const data = (await res.json()) as {
            projects: { id: string; name: string }[];
            allocations: Array<{
              projectId: string;
              fpAllocation: number;
              percent: number | null;
              effectiveFrom: string | null;
              allocationId: string | null;
            }>;
          };
          if (cancelled) return;
          setProjects(data.projects ?? []);
          setAllocs(
            (data.allocations ?? []).map((a) => ({
              key: a.projectId,
              projectId: a.projectId,
              fpAllocation: String(a.fpAllocation ?? 0),
              percent: a.percent != null ? String(a.percent) : "",
              effectiveFrom: a.effectiveFrom ?? today(),
              allocationId: a.allocationId,
            })),
          );
        } finally {
          if (!cancelled) setLoadingAlloc(false);
        }
      } else {
        // Criação: membro não existe ainda → só a lista de projetos.
        const supabase = createClient();
        const { data } = await supabase
          .from("Project")
          .select("id, name")
          .order("name");
        if (!cancelled) setProjects((data ?? []) as { id: string; name: string }[]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [member]);

  // ─── allocation row mutators ───
  let rowSeq = 0;
  const addRow = () =>
    setAllocs((rows) => [
      ...rows,
      {
        key: `new-${Date.now()}-${rows.length}-${rowSeq++}`,
        projectId: "",
        fpAllocation: "0",
        percent: "",
        effectiveFrom: today(),
        allocationId: null,
      },
    ]);

  const updateRow = (key: string, patch: Partial<AllocRow>) =>
    setAllocs((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const removeRow = (key: string) =>
    setAllocs((rows) => rows.filter((r) => r.key !== key));

  // ─── derived ───
  const capacity = parseInt(form.fpCapacity) || 0;
  const sumFp = allocs.reduce((s, a) => s + (parseInt(a.fpAllocation) || 0), 0);
  const sumPct = allocs.reduce((s, a) => s + (parseFloat(a.percent) || 0), 0);
  const fpOver = sumFp > capacity;
  const pctOver = sumPct > 100;
  const usedProjectIds = new Set(allocs.map((a) => a.projectId).filter(Boolean));

  const canSave =
    !saving &&
    form.name.trim().length > 0 &&
    form.email.trim().length > 0 &&
    !(form.createAccount && !editing && form.password.length < 6) &&
    !fpOver &&
    !pctOver;

  // ─── save ───
  async function save() {
    setSaving(true);
    setError(null);
    try {
      const baseBody: Record<string, unknown> = {
        name: form.name,
        email: form.email || null,
        position: form.position || null,
        specialty: form.specialty || null,
        githubUsername: form.githubUsername || null,
        fpCapacity: parseInt(form.fpCapacity) || 125,
        isExternal: form.isExternal,
      };
      if (form.createAccount) baseBody.accessLevel = form.accessLevel;

      let memberId = member?.id ?? null;

      if (editing) {
        const body = form.password
          ? { ...baseBody, password: form.password }
          : baseBody;
        const res = await fetch(`/api/members/${member!.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw await errorFrom(res);
      } else {
        const body = {
          ...baseBody,
          createAccount: form.createAccount,
          password: form.createAccount ? form.password : undefined,
        };
        const res = await fetch(`/api/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw await errorFrom(res);
        const created = (await res.json()) as { id: string };
        memberId = created.id;
      }

      // Alocações (PFV + % contrato) num único PUT; o server faz o diff.
      if (memberId) {
        const payload = {
          allocations: allocs
            .filter((a) => a.projectId)
            .map((a) => ({
              projectId: a.projectId,
              fpAllocation: parseInt(a.fpAllocation) || 0,
              percent: a.percent ? parseFloat(a.percent) : 0,
              effectiveFrom: a.effectiveFrom || null,
              allocationId: a.allocationId,
            })),
        };
        const res = await fetch(`/api/members/${memberId}/allocations`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw await errorFrom(res);
      }

      toast.success(editing ? "Membro atualizado" : "Membro criado");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <ResponsiveSheetHeader>
        <ResponsiveSheetTitle>
          {editing ? "Editar membro" : "Novo membro"}
        </ResponsiveSheetTitle>
        <ResponsiveSheetDescription>
          Identidade, acesso, especialidade e alocação por projeto (PFV + %). Equipe de contrato é na Equipe do contrato.
        </ResponsiveSheetDescription>
      </ResponsiveSheetHeader>

      <ResponsiveSheetBody className="space-y-8">
        {/* ─── Identidade ─── */}
        <section className="space-y-3">
          <SectionTitle>Identidade</SectionTitle>
          <FormBody>
            <Field.Row cols={2}>
              <Field name="name" required>
                <Field.Label>Nome</Field.Label>
                <Field.Control>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </Field.Control>
              </Field>
              <Field name="email" required>
                <Field.Label>Email</Field.Label>
                <Field.Control>
                  <Input
                    type="email"
                    value={form.email}
                    disabled={editing}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </Field.Control>
                {editing && (
                  <Field.Hint>Email não muda depois da criação.</Field.Hint>
                )}
              </Field>
            </Field.Row>

            <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Membro externo</p>
                <p className="text-xs text-muted-foreground">
                  Cedido por outra empresa (ex: Extreme Group).
                </p>
              </div>
              <Switch
                checked={form.isExternal}
                onCheckedChange={(v) => setForm({ ...form, isExternal: v })}
              />
            </div>
          </FormBody>
        </section>

        {/* ─── Acesso & cargo ─── */}
        <section className="space-y-3">
          <SectionTitle>Acesso & cargo</SectionTitle>
          <FormBody>
            <Field.Row cols={2}>
              <Field name="position">
                <Field.Label>Cargo</Field.Label>
                <Field.Control>
                  <Select
                    value={form.position || NONE}
                    onValueChange={(v) => {
                      if (!v) return;
                      const next = v === NONE ? "" : v;
                      setForm((f) => ({
                        ...f,
                        position: next,
                        accessLevel:
                          f.accessLevel === mapPositionToAccessLevel(f.position)
                            ? mapPositionToAccessLevel(next)
                            : f.accessLevel,
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {(v: string | null) =>
                          !v || v === NONE ? "— Sem cargo" : positionLabel(v)
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— Sem cargo</SelectItem>
                      {POSITIONS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {POSITION_LABELS[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field.Control>
                <Field.Hint>Opcional para externos / contas de grupo.</Field.Hint>
              </Field>

              {form.createAccount && (
                <Field name="accessLevel" required>
                  <Field.Label>Nível de acesso</Field.Label>
                  <Field.Control>
                    <Select
                      value={form.accessLevel}
                      onValueChange={(v) =>
                        v && setForm({ ...form, accessLevel: v as AccessLevel })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue>
                          {(v: string | null) =>
                            v ? ACCESS_LEVEL_LABELS[v as AccessLevel] : "—"
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {MEMBER_ACCESS_LEVELS.map((al) => (
                          <SelectItem key={al} value={al}>
                            {ACCESS_LEVEL_LABELS[al]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field.Control>
                </Field>
              )}
            </Field.Row>

            <p className="text-xs text-muted-foreground">
              Cargo é o título do membro; nível de acesso controla o que ele pode
              fazer na plataforma. Você pode promover (ex: admin a alguém sem
              cargo de produto).
            </p>

            {!editing ? (
              <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">Criar conta de login</p>
                  <p className="text-xs text-muted-foreground">
                    Desligue para um registro externo que não loga no sistema.
                  </p>
                </div>
                <Switch
                  checked={form.createAccount}
                  onCheckedChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      createAccount: v,
                      password: v && !f.password ? generatePassword() : f.password,
                    }))
                  }
                />
              </div>
            ) : !member?.hasAccount ? (
              <p className="text-xs text-muted-foreground rounded-md border border-border/60 px-3 py-2.5">
                Registro sem conta de login.
              </p>
            ) : null}

            {((!editing && form.createAccount) ||
              (editing && member?.hasAccount)) && (
              <Field name="password">
                <Field.Label>
                  Senha {editing && "(deixe em branco pra manter)"}
                </Field.Label>
                <div className="flex gap-2">
                  <Field.Control>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={form.password}
                      placeholder={editing ? "•••••••• (mantida)" : ""}
                      onChange={(e) =>
                        setForm({ ...form, password: e.target.value })
                      }
                    />
                  </Field.Control>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Gerar senha"
                    onClick={() =>
                      setForm({ ...form, password: generatePassword() })
                    }
                  >
                    <Wand2 className="h-4 w-4" />
                  </Button>
                </div>
                {!editing && (
                  <Field.Hint>
                    Mínimo 6 caracteres. Entregue ao membro por um canal seguro.
                  </Field.Hint>
                )}
              </Field>
            )}
          </FormBody>
        </section>

        {/* ─── Especialidade & capacidade ─── */}
        <section className="space-y-3">
          <SectionTitle>Especialidade & capacidade</SectionTitle>
          <FormBody>
            <Field name="specialty">
              <Field.Label>Torre principal</Field.Label>
              <Field.Control>
                <Select
                  value={form.specialty || NONE}
                  onValueChange={(v) =>
                    v && setForm({ ...form, specialty: v === NONE ? "" : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue>
                      {(v: string | null) =>
                        !v || v === NONE ? "— Sem torre" : towerLabel(v)
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— Sem torre</SelectItem>
                    {TOWERS.map((t) => (
                      <SelectItem key={t.key} value={t.key}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field.Control>
              <Field.Hint>
                Mesmas torres da grid &quot;Torres de especialidade&quot;.
              </Field.Hint>
            </Field>

            <Field.Row cols={2}>
              <Field name="github">
                <Field.Label>GitHub Username</Field.Label>
                <Field.Control>
                  <Input
                    value={form.githubUsername}
                    onChange={(e) =>
                      setForm({ ...form, githubUsername: e.target.value })
                    }
                  />
                </Field.Control>
              </Field>
              <Field name="capacity">
                <Field.Label>Capacidade PFV / sprint</Field.Label>
                <Field.Control>
                  <Input
                    type="number"
                    value={form.fpCapacity}
                    onChange={(e) =>
                      setForm({ ...form, fpCapacity: e.target.value })
                    }
                  />
                </Field.Control>
              </Field>
            </Field.Row>
          </FormBody>
        </section>

        {/* ─── Alocação ─── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionTitle>Alocação</SectionTitle>
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Alocar em projeto
            </Button>
          </div>

          {loadingAlloc ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando alocações…
            </div>
          ) : allocs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              Sem alocações. Use &quot;Alocar em projeto&quot;.
            </p>
          ) : (
            <div className="space-y-2">
              {allocs.map((row) => {
                return (
                  <div
                    key={row.key}
                    className="rounded-md border border-border/60 p-3 space-y-2.5"
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <FieldLabelSm>Projeto</FieldLabelSm>
                        <Select
                          value={row.projectId || null}
                          onValueChange={(v) => {
                            if (!v) return;
                            updateRow(row.key, { projectId: v });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue>
                              {(v: string | null) =>
                                v
                                  ? projects.find((p) => p.id === v)?.name ?? "—"
                                  : "Selecione um projeto"
                              }
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {projects.map((p) => (
                              <SelectItem
                                key={p.id}
                                value={p.id}
                                disabled={
                                  usedProjectIds.has(p.id) && p.id !== row.projectId
                                }
                              >
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mt-5 text-muted-foreground"
                        title="Remover alocação"
                        onClick={() => removeRow(row.key)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <FieldLabelSm>PFV / sprint</FieldLabelSm>
                        <Input
                          type="number"
                          value={row.fpAllocation}
                          onChange={(e) =>
                            updateRow(row.key, { fpAllocation: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <FieldLabelSm>%</FieldLabelSm>
                        <Input
                          type="number"
                          value={row.percent}
                          placeholder="—"
                          onChange={(e) =>
                            updateRow(row.key, { percent: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <FieldLabelSm>Desde</FieldLabelSm>
                        <Input
                          type="date"
                          value={row.effectiveFrom}
                          onChange={(e) =>
                            updateRow(row.key, { effectiveFrom: e.target.value })
                          }
                        />
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Totais */}
              <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1 text-xs">
                <span className={pctOver ? "text-destructive" : "text-muted-foreground"}>
                  Σ {sumPct}% / 100
                </span>
                <span className={fpOver ? "text-destructive" : "text-muted-foreground"}>
                  Σ {sumFp} / {capacity} PFV
                </span>
              </div>
            </div>
          )}
        </section>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Zona de saída — desativar (soft-delete) ≠ excluir. Admin-only. */}
        {editing && isAdmin && member && (
          <section className="mt-2 border-t border-destructive/20 pt-4">
            {member.deactivatedAt ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Inativo desde{" "}
                  {new Date(member.deactivatedAt).toLocaleDateString("pt-BR")}
                  {member.deactivatedReason
                    ? ` · ${DEACTIVATION_REASON_LABELS[member.deactivatedReason] ?? member.deactivatedReason}`
                    : ""}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onReactivate?.(member)}
                >
                  Reativar membro
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Desligado ou saiu da empresa? Desative — perde acesso e sai dos
                  rosters, mas o histórico é mantido.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="text-destructive hover:text-destructive shrink-0"
                  onClick={() => onDeactivate?.(member)}
                >
                  Desativar membro
                </Button>
              </div>
            )}
          </section>
        )}
      </ResponsiveSheetBody>

      <ResponsiveSheetFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancelar
        </Button>
        <Button onClick={save} disabled={!canSave}>
          {saving ? "Salvando…" : editing ? "Salvar" : "Criar membro"}
        </Button>
      </ResponsiveSheetFooter>
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

function FieldLabelSm({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}
