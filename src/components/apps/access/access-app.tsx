"use client";

/**
 * App Acessos (Overview → Apps, admin-only). Duas colunas:
 *   - Esquerda: lista de membros (busca + tag de conta).
 *   - Direita: ACESSO EFETIVO do membro selecionado (nível global + ProjectAccess
 *     + grants ativos) e o editor de concessões (conceder capability / revogar).
 *
 * Override = MemberAccessGrant. Capability project-scoped pede um projeto;
 * global (ex.: S&OP) não. Revogar é soft (some da lista de ativos).
 * Console aesthetic: hairline, mono pra keys, sem emoji.
 */

import { useEffect, useMemo, useState } from "react";
import { KeyRound, Plus, Search, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ConfirmDialog,
  type ConfirmState,
} from "@/components/ui/confirm-dialog";
import { createClient } from "@/lib/supabase/client";
import { loadMembersList, type MembersListItem } from "@/lib/members/members-load";
import {
  CAPABILITIES,
  CAPABILITY_BY_KEY,
} from "@/lib/access/capabilities";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { accessLevelLabel, positionLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";

type ProjectOption = { id: string; name: string };

type ProjectAccessRow = {
  projectId: string;
  role: string;
  project: { name: string } | null;
};

type ActiveGrant = {
  id: string;
  capabilityKey: string;
  scope: "global" | "project";
  projectId: string | null;
  grantedAt: string;
  project: { name: string } | null;
};

type EffectiveResponse = {
  member: { id: string; name: string; position: string | null; hasAccount: boolean };
  accessLevel: string;
  projectAccess: ProjectAccessRow[];
  grants: ActiveGrant[];
};

export function AccessApp() {
  const [members, setMembers] = useState<MembersListItem[] | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [query, setQuery] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [effective, setEffective] = useState<EffectiveResponse | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  // Form de conceder.
  const [newCapabilityKey, setNewCapabilityKey] = useState<string>("");
  const [newProjectId, setNewProjectId] = useState<string>("");
  const [granting, setGranting] = useState(false);

  // ─── Loads (setState só em callbacks de promise — sem set-state-in-effect) ──
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    loadMembersList(supabase)
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    supabase
      .from("Project")
      .select("id, name")
      .order("name")
      .then(({ data }) => {
        if (!cancelled) setProjects((data ?? []) as ProjectOption[]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedMemberId) return;
    let cancelled = false;
    fetch(`/api/access/effective?memberId=${selectedMemberId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setEffective(d as EffectiveResponse);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedMemberId]);

  function reloadEffective(memberId: string) {
    fetch(`/api/access/effective?memberId=${memberId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setEffective(d as EffectiveResponse);
      })
      .catch(() => {});
  }

  const filteredMembers = useMemo(() => {
    const base = (members ?? []).filter((m) => !m.deactivatedAt);
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.email ?? "").toLowerCase().includes(q),
    );
  }, [members, query]);

  // effective ainda é do membro anterior enquanto carrega o novo.
  const effectiveReady =
    !!selectedMemberId && effective?.member.id === selectedMemberId;
  const selectedCap = newCapabilityKey
    ? CAPABILITY_BY_KEY.get(newCapabilityKey)
    : undefined;
  const needsProject = selectedCap?.scope === "project";
  const canGrant =
    !!selectedCap &&
    !granting &&
    effectiveReady &&
    !!effective?.member.hasAccount &&
    (!needsProject || !!newProjectId);

  async function handleGrant() {
    if (!selectedMemberId || !selectedCap) return;
    setGranting(true);
    try {
      const res = await fetchOrThrow("/api/access-grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: selectedMemberId,
          capabilityKey: selectedCap.key,
          projectId: needsProject ? newProjectId : null,
        }),
      });
      const { existed } = (await res.json()) as { existed?: boolean };
      toast.success(
        existed ? "Esse acesso já existia." : "Acesso concedido.",
      );
      setNewCapabilityKey("");
      setNewProjectId("");
      reloadEffective(selectedMemberId);
    } catch (err) {
      showErrorToast(err, { label: "Falha ao conceder acesso" });
    } finally {
      setGranting(false);
    }
  }

  function handleRevoke(grant: ActiveGrant) {
    const capLabel =
      CAPABILITY_BY_KEY.get(grant.capabilityKey)?.label ?? grant.capabilityKey;
    const scopeLabel = grant.project ? ` em ${grant.project.name}` : "";
    setConfirmState({
      title: `Revogar acesso "${capLabel}"${scopeLabel}?`,
      description: "O membro perde essa capability imediatamente.",
      confirmLabel: "Revogar",
      destructive: true,
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/access-grants/${grant.id}`, {
            method: "DELETE",
          });
          toast.success("Acesso revogado.");
          if (selectedMemberId) reloadEffective(selectedMemberId);
        } catch (err) {
          showErrorToast(err, { label: "Falha ao revogar" });
        }
      },
    });
  }

  return (
    <div className="flex flex-col gap-3 md:flex-row md:gap-4">
      {/* ─── Esquerda: membros ─────────────────────────────────────────── */}
      <aside className="w-full shrink-0 space-y-2 md:w-64">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar membro…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="max-h-[60vh] divide-y divide-border/60 overflow-y-auto rounded-md border">
          {members === null ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Carregando…
            </p>
          ) : filteredMembers.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nenhum membro.
            </p>
          ) : (
            filteredMembers.map((m) => {
              const active = m.id === selectedMemberId;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedMemberId(m.id)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/60",
                    active && "bg-muted",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {positionLabel(m.position)}
                    </p>
                  </div>
                  {!m.hasAccount && (
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      sem conta
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* ─── Direita: acesso efetivo + editor ──────────────────────────── */}
      <div className="min-w-0 flex-1">
        {!selectedMemberId ? (
          <div className="flex h-full min-h-[40vh] items-center justify-center rounded-md border text-center text-sm text-muted-foreground">
            Selecione um membro para ver e gerenciar o acesso.
          </div>
        ) : !effectiveReady ? (
          <p className="px-1 py-8 text-center text-sm text-muted-foreground">
            Carregando acesso…
          </p>
        ) : (
          <EffectivePanel
            data={effective!}
            projects={projects}
            newCapabilityKey={newCapabilityKey}
            onCapabilityChange={(v) => {
              setNewCapabilityKey(v);
              setNewProjectId("");
            }}
            newProjectId={newProjectId}
            onProjectChange={setNewProjectId}
            needsProject={needsProject}
            canGrant={canGrant}
            onGrant={handleGrant}
            onRevoke={handleRevoke}
          />
        )}
      </div>

      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </div>
  );
}

function EffectivePanel({
  data,
  projects,
  newCapabilityKey,
  onCapabilityChange,
  newProjectId,
  onProjectChange,
  needsProject,
  canGrant,
  onGrant,
  onRevoke,
}: {
  data: EffectiveResponse;
  projects: ProjectOption[];
  newCapabilityKey: string;
  onCapabilityChange: (v: string) => void;
  newProjectId: string;
  onProjectChange: (v: string) => void;
  needsProject: boolean;
  canGrant: boolean;
  onGrant: () => void;
  onRevoke: (grant: ActiveGrant) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Cabeçalho do membro + nível global */}
      <div className="flex items-center justify-between gap-2 border-b pb-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{data.member.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {positionLabel(data.member.position)}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs">
          <Shield className="size-3.5 text-muted-foreground" />
          {accessLevelLabel(data.accessLevel)}
        </span>
      </div>

      {!data.member.hasAccount && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Este membro não tem conta de login — não pode receber concessões.
        </p>
      )}

      {/* Acesso por projeto (ProjectAccess) */}
      <section className="space-y-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Acesso por projeto · {data.projectAccess.length}
        </p>
        {data.projectAccess.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Sem ProjectAccess — vê projetos só via concessão abaixo.
          </p>
        ) : (
          <div className="divide-y divide-border/60 rounded-md border">
            {data.projectAccess.map((p) => (
              <div
                key={p.projectId}
                className="flex items-center justify-between gap-2 px-3 py-2"
              >
                <span className="truncate text-sm">
                  {p.project?.name ?? p.projectId}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {p.role}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Concessões ativas (override) */}
      <section className="space-y-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Concessões ativas · {data.grants.length}
        </p>
        {data.grants.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhuma concessão ativa.
          </p>
        ) : (
          <div className="divide-y divide-border/60 rounded-md border">
            {data.grants.map((g) => {
              const label =
                CAPABILITY_BY_KEY.get(g.capabilityKey)?.label ?? g.capabilityKey;
              return (
                <div
                  key={g.id}
                  className="flex items-center gap-2 px-3 py-2"
                >
                  <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{label}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {g.project ? g.project.name : "global"}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Revogar ${label}`}
                    title="Revogar"
                    onClick={() => onRevoke(g)}
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Conceder nova capability */}
      <section className="space-y-2 rounded-md border bg-muted/20 p-3">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Conceder acesso
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select
            value={newCapabilityKey}
            onValueChange={(v) => onCapabilityChange(v ?? "")}
          >
            <SelectTrigger className="sm:w-48">
              <SelectValue placeholder="Capability" />
            </SelectTrigger>
            <SelectContent>
              {CAPABILITIES.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  <span className="flex flex-col items-start">
                    <span>{c.label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {c.kind === "ritual" ? "ritual" : "app"} · {c.scope}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {needsProject && (
            <Select
              value={newProjectId}
              onValueChange={(v) => onProjectChange(v ?? "")}
            >
              <SelectTrigger className="sm:w-56">
                <SelectValue placeholder="Projeto" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            size="sm"
            onClick={onGrant}
            disabled={!canGrant}
            className="sm:ml-auto"
          >
            <Plus className="size-3.5" /> Conceder
          </Button>
        </div>
        {needsProject && (
          <p className="text-[11px] text-muted-foreground">
            Capability de projeto: o membro passa a enxergar só este projeto
            (apenas a superfície concedida).
          </p>
        )}
      </section>
    </div>
  );
}
