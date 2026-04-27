"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
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
import { MoreVertical, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

type AccessRow = {
  userId: string;
  email: string | null;
  name: string | null;
  role: "viewer" | "session_participant" | "contributor" | "lead";
  isMember: boolean;
  memberId: string | null;
  fpAllocation: number | null;
  grantedAt: string;
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

export function ProjectAccessSheet({ projectId, open, onOpenChange }: Props) {
  const [rows, setRows] = useState<AccessRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] =
    useState<AccessRow["role"]>("viewer");
  const [inviting, setInviting] = useState(false);

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

  const revoke = async (userId: string) => {
    if (!confirm("Revogar acesso desta pessoa ao projeto?")) return;
    const prev = rows;
    setRows((r) => r.filter((x) => x.userId !== userId));
    const res = await fetch(`/api/projects/${projectId}/access/${userId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setRows(prev);
      toast.error("Falha ao revogar");
    }
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
      const json = await res.json();
      toast.success(
        json.emailDispatched ? "Convite enviado" : "Acesso concedido",
      );
      setInviteEmail("");
      setInviteRole("viewer");
      await load();
    } finally {
      setInviting(false);
    }
  };

  const members = rows.filter((r) => r.isMember);
  const guests = rows.filter((r) => !r.isMember);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col gap-0 p-0">
        <div className="px-6 pt-6 pb-4 border-b">
          <h2 className="font-heading text-base font-medium">
            Acesso ao projeto
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Gerencia quem pode ver e editar este projeto. Members alocados
            entram automaticamente como contributor.
          </p>
        </div>

        <div className="px-6 py-4 border-b bg-muted/30 space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Convidar
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="email@empresa.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              type="email"
              className="flex-1"
            />
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
            <Button onClick={invite} disabled={inviting}>
              <UserPlus className="h-4 w-4 mr-1" />
              Convidar
            </Button>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Se a pessoa não tiver conta, criamos uma como guest e enviamos
            magic link.
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
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
              emptyText="Nenhum guest convidado"
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  title,
  rows,
  onRoleChange,
  onRevoke,
  emptyText,
}: {
  title: string;
  rows: AccessRow[];
  onRoleChange: (userId: string, role: AccessRow["role"]) => void;
  onRevoke: (userId: string) => void;
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
                {r.isMember &&
                  r.fpAllocation === null &&
                  r.role === "viewer" && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      (desalocado — acesso histórico)
                    </div>
                  )}
                {r.isMember && r.fpAllocation !== null && (
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    FP: {r.fpAllocation}
                  </div>
                )}
              </div>
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
                  <DropdownMenuItem
                    onClick={() => onRevoke(r.userId)}
                    className="text-destructive"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Revogar acesso
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
