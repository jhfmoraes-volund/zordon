"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
} from "@/components/ui/responsive-sheet";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, Copy, LinkIcon, MoreVertical, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import {
  ConfirmDialog,
  type ConfirmState,
} from "@/components/ui/confirm-dialog";

type AccessRow = {
  userId: string;
  email: string | null;
  name: string | null;
  role: "viewer" | "session_participant" | "contributor" | "lead";
  isMember: boolean;
  memberId: string | null;
  fpAllocation: number | null;
  grantedAt: string;
  isManager: boolean;
  managerPosition: string | null;
  managerPositionLabel: string | null;
  managerAccessLevel: string | null;
};

const ROLE_OPTIONS = [
  { value: "viewer", label: "Viewer", hint: "Só lê" },
  {
    value: "session_participant",
    label: "Session Participant",
    hint: "Lê + edita Sessions",
  },
  { value: "contributor", label: "Contributor", hint: "Edita tudo" },
  { value: "lead", label: "Lead", hint: "Edita + gerencia acesso" },
] as const;

type Props = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type GeneratedLink = {
  userId: string;
  label: string;
  link: string;
  type: "set_password" | "magic_link";
};

export function ProjectAccessSheet({ projectId, open, onOpenChange }: Props) {
  const [rows, setRows] = useState<AccessRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] =
    useState<AccessRow["role"]>("viewer");
  const [inviting, setInviting] = useState(false);
  // Quando geramos/re-geramos um link, exibimos num card no topo até o user fechar.
  const [generated, setGenerated] = useState<GeneratedLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Link copiado");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione manualmente.");
    }
  }

  async function regenerateLink(userId: string, label: string) {
    const res = await fetch(
      `/api/projects/${projectId}/access/${userId}/regenerate-link`,
      { method: "POST" },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Falha ao gerar link");
      return;
    }
    const json = await res.json();
    setGenerated({
      userId,
      label,
      link: json.link,
      type: json.type,
    });
    await copyToClipboard(json.link);
  }

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/access`);
      if (!res.ok) {
        toast.error("Falha ao carregar acessos");
        return;
      }
      setRows(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
  }, [open, projectId]);

  const updateRole = async (userId: string, role: AccessRow["role"]) => {
    const prev = rows;
    setRows((r) => r.map((x) => (x.userId === userId ? { ...x, role } : x)));
    const res = await fetch(`/api/projects/${projectId}/access/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      setRows(prev);
      toast.error("Falha ao atualizar role");
    }
  };

  const revoke = (userId: string) => {
    setConfirmState({
      title: "Revogar acesso desta pessoa ao projeto?",
      confirmLabel: "Revogar",
      destructive: true,
      onConfirm: async () => {
        const prev = rows;
        setRows((r) => r.filter((x) => x.userId !== userId));
        const res = await fetch(`/api/projects/${projectId}/access/${userId}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          setRows(prev);
          toast.error("Falha ao revogar");
        }
      },
    });
  };

  const invite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      toast.error("Email inválido");
      return;
    }
    setInviting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Falha ao convidar");
        return;
      }
      const json = (await res.json()) as {
        userId: string;
        inviteLink: string | null;
        inviteType: "set_password" | "magic_link" | null;
      };
      if (json.inviteLink && json.inviteType) {
        setGenerated({
          userId: json.userId,
          label: email,
          link: json.inviteLink,
          type: json.inviteType,
        });
        await copyToClipboard(json.inviteLink);
      } else {
        toast.success("Acesso concedido");
      }
      setInviteEmail("");
      setInviteRole("viewer");
      await load();
    } finally {
      setInviting(false);
    }
  };

  const members = rows.filter((r) => r.isMember || r.isManager);
  const guests = rows.filter((r) => !r.isMember && !r.isManager);

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="md">
        <div className="px-4 pt-2 pb-4 border-b sm:px-6 sm:pt-6">
          <h2 className="font-heading text-base font-medium">
            Acesso ao projeto
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Gerencia quem pode ver e editar este projeto. Members alocados
            entram automaticamente como contributor.
          </p>
        </div>

        <div className="px-4 py-4 border-b bg-muted/30 space-y-2 sm:px-6">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Convidar
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="email@empresa.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              type="email"
              className="flex-1"
            />
            <div className="flex gap-2">
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as AccessRow["role"])}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={invite} disabled={inviting} className="flex-1 sm:flex-none">
                <UserPlus className="h-4 w-4 mr-1" />
                Convidar
              </Button>
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Se a pessoa não tiver conta, criamos uma como guest e geramos um
            link de acesso pra você compartilhar (sem email).
          </div>
        </div>

        {generated && (
          <div className="mx-4 mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 sm:mx-6 dark:border-emerald-900/50 dark:bg-emerald-950/30">
            <div className="flex items-start gap-2">
              <LinkIcon className="mt-0.5 h-4 w-4 text-emerald-700 dark:text-emerald-400" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                  {generated.type === "set_password"
                    ? `Link de primeiro acesso pra ${generated.label}`
                    : `Magic link gerado pra ${generated.label}`}
                </div>
                <p className="mt-0.5 text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
                  {generated.type === "set_password"
                    ? "Ao abrir, a pessoa vai definir uma senha. Válido por 24h, uso único."
                    : "Login 1-shot. Válido por 24h. Próximos logins via /login com a senha."}
                </p>
                <div className="mt-2 flex items-center gap-2 rounded-sm border bg-background px-2 py-1.5">
                  <span className="flex-1 truncate font-mono text-xs">
                    {generated.link}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => copyToClipboard(generated.link)}
                    aria-label="Copiar link"
                  >
                    {copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setGenerated(null)}
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6 sm:px-6">
          {loading && (
            <div className="text-sm text-muted-foreground">Carregando…</div>
          )}

          {!loading && (
            <Section
              title={`Members (${members.length})`}
              rows={members}
              onRoleChange={updateRole}
              onRevoke={revoke}
              emptyText="Nenhum member com acesso"
            />
          )}

          {!loading && (
            <Section
              title={`Guests (${guests.length})`}
              rows={guests}
              onRoleChange={updateRole}
              onRevoke={revoke}
              onRegenerateLink={regenerateLink}
              emptyText="Nenhum guest convidado"
            />
          )}
        </div>
      </ResponsiveSheetContent>
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </ResponsiveSheet>
  );
}

function Section({
  title,
  rows,
  onRoleChange,
  onRevoke,
  onRegenerateLink,
  emptyText,
}: {
  title: string;
  rows: AccessRow[];
  onRoleChange: (userId: string, role: AccessRow["role"]) => void;
  onRevoke: (userId: string) => void;
  onRegenerateLink?: (userId: string, label: string) => void;
  emptyText: string;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">{emptyText}</div>
      ) : (
        <div className="divide-y border rounded-md">
          {rows.map((r) => (
            <div
              key={r.userId}
              className="flex items-center gap-3 px-3 py-2.5"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {r.name ?? r.email ?? r.userId}
                </div>
                {r.name && r.email && (
                  <div className="text-xs text-muted-foreground truncate">
                    {r.email}
                  </div>
                )}
                {r.isManager && r.managerPositionLabel && (
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {r.managerPositionLabel} · acesso total
                  </div>
                )}
                {!r.isManager &&
                  r.isMember &&
                  r.fpAllocation === null &&
                  r.role === "viewer" && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      (desalocado — acesso histórico)
                    </div>
                  )}
                {!r.isManager && r.isMember && r.fpAllocation !== null && (
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    PFV: {r.fpAllocation}
                  </div>
                )}
              </div>
              {r.isManager ? (
                <span className="text-xs text-muted-foreground px-2 py-1 rounded-md border bg-muted/40 capitalize">
                  {r.managerAccessLevel ?? "manager"}
                </span>
              ) : (
                <>
                  <Select
                    value={r.role}
                    onValueChange={(v) =>
                      onRoleChange(r.userId, v as AccessRow["role"])
                    }
                  >
                    <SelectTrigger className="w-44 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <span className="flex flex-col items-start">
                            <span>{opt.label}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {opt.hint}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="ghost" size="icon-sm">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end">
                      {onRegenerateLink && (
                        <DropdownMenuItem
                          onClick={() =>
                            onRegenerateLink(
                              r.userId,
                              r.email ?? r.name ?? r.userId,
                            )
                          }
                        >
                          <LinkIcon className="h-4 w-4 mr-2" />
                          Gerar novo link
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={() => onRevoke(r.userId)}
                        className="text-destructive"
                      >
                        <X className="h-4 w-4 mr-2" />
                        Revogar acesso
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
