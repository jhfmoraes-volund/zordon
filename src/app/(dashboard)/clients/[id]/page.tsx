"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Mail,
  Pencil,
  Phone,
  Plus,
  StickyNote,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  ConfirmDialog,
  type ConfirmState,
} from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CsatResponseSheet,
  type CsatFormValues,
  type CsatMember,
} from "@/components/clients/csat-response-sheet";
import {
  CsatResponseCard,
  type CsatResponseWithInterviewer,
} from "@/components/clients/csat-response-card";
import {
  ClientProjectCard,
  type ClientProject,
} from "@/components/clients/client-project-card";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { useAuth } from "@/contexts/auth-context";
import { createClient } from "@/lib/supabase/client";
import { showErrorToast } from "@/lib/optimistic/toast";
import type { Client } from "@/lib/supabase/types";

type EditForm = {
  name: string;
  email: string;
  phone: string;
  notes: string;
};

function emptyEditForm(): EditForm {
  return { name: "", email: "", phone: "", notes: "" };
}

function clientToForm(c: Client): EditForm {
  return {
    name: c.name,
    email: c.email ?? "",
    phone: c.phone ?? "",
    notes: c.notes ?? "",
  };
}

export default function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { member } = useAuth();
  const currentMemberId = member?.id ?? null;

  const [client, setClient] = useState<Client | null>(null);
  const [projects, setProjects] = useState<ClientProject[]>([]);
  const [members, setMembers] = useState<CsatMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const csatCollection = useOptimisticCollection<CsatResponseWithInterviewer>(
    [],
  );

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>(emptyEditForm);
  const [savingEdit, setSavingEdit] = useState(false);

  const [csatOpen, setCsatOpen] = useState(false);
  const [editingCsat, setEditingCsat] =
    useState<CsatResponseWithInterviewer | null>(null);

  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  async function load() {
    setLoading(true);
    const [clientRes, projectsRes, csatRes, membersRes] = await Promise.all([
      supabase.from("Client").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("Project")
        .select(
          "id, name, status, startDate, endDate, projectMembers:ProjectMember(memberId), taskCount:Task(count)",
        )
        .eq("clientId", id)
        .order("createdAt", { ascending: false }),
      supabase
        .from("CsatResponse")
        .select("*, interviewer:Member!interviewedBy(id, name)")
        .eq("clientId", id)
        .order("interviewedAt", { ascending: false }),
      supabase.from("Member").select("id, name").order("name"),
    ]);

    if (!clientRes.data) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setClient(clientRes.data as Client);
    setProjects(
      ((projectsRes.data ?? []) as Array<{
        id: string;
        name: string;
        status: string;
        startDate: string | null;
        endDate: string | null;
        projectMembers: Array<{ memberId: string }>;
        taskCount: Array<{ count: number }>;
      }>).map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        startDate: p.startDate,
        endDate: p.endDate,
        memberCount: p.projectMembers?.length ?? 0,
        taskCount: p.taskCount?.[0]?.count ?? 0,
      })),
    );
    csatCollection.setCommitted(
      (csatRes.data ?? []) as CsatResponseWithInterviewer[],
    );
    setMembers((membersRes.data ?? []) as CsatMember[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function openEditClient() {
    if (!client) return;
    setEditForm(clientToForm(client));
    setEditOpen(true);
  }

  async function saveClient() {
    if (!client) return;
    if (!editForm.name.trim()) return;
    setSavingEdit(true);
    try {
      const body = {
        name: editForm.name.trim(),
        email: editForm.email.trim() || null,
        phone: editForm.phone.trim() || null,
        notes: editForm.notes.trim() || null,
      };
      const { data, error } = await supabase
        .from("Client")
        .update(body)
        .eq("id", client.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      if (data) setClient(data as Client);
      setEditOpen(false);
    } catch (e) {
      showErrorToast(e, { label: "Falha ao salvar cliente" });
    } finally {
      setSavingEdit(false);
    }
  }

  function confirmDeleteClient() {
    if (!client) return;
    const csatCount = csatCollection.items.length;
    const projectCount = projects.length;
    const blockers: string[] = [];
    if (projectCount > 0) {
      blockers.push(
        `${projectCount} ${projectCount === 1 ? "projeto" : "projetos"}`,
      );
    }
    if (csatCount > 0) {
      blockers.push(
        `${csatCount} ${csatCount === 1 ? "entrevista CSAT" : "entrevistas CSAT"}`,
      );
    }
    const tail = blockers.length
      ? ` Será apagado permanentemente: ${blockers.join(" e ")}.`
      : "";

    setConfirmState({
      title: `Remover ${client.name}?`,
      description: `Esta ação remove o cliente e todos os dados vinculados.${tail}`,
      destructive: true,
      confirmLabel: "Excluir cliente",
      onConfirm: async () => {
        const { error } = await supabase
          .from("Client")
          .delete()
          .eq("id", client.id);
        if (error) {
          showErrorToast(error, { label: "Falha ao remover cliente" });
          return;
        }
        router.push("/clients");
      },
    });
  }

  function openNewCsat() {
    setEditingCsat(null);
    setCsatOpen(true);
  }

  function openEditCsat(r: CsatResponseWithInterviewer) {
    setEditingCsat(r);
    setCsatOpen(true);
  }

  function confirmDeleteCsat(r: CsatResponseWithInterviewer) {
    setConfirmState({
      title: "Remover entrevista?",
      description: `Entrevista de ${new Date(r.interviewedAt).toLocaleDateString("pt-BR")} será apagada.`,
      destructive: true,
      confirmLabel: "Excluir",
      onConfirm: async () => {
        await csatCollection.mutate(
          { type: "delete", id: r.id },
          async () => {
            const { error } = await supabase
              .from("CsatResponse")
              .delete()
              .eq("id", r.id);
            if (error) throw new Error(error.message);
            return { ok: true as const, id: r.id };
          },
          {
            errorLabel: "Falha ao remover entrevista",
            reconcile: (prev) => prev.filter((c) => c.id !== r.id),
          },
        );
      },
    });
  }

  async function submitCsat(values: CsatFormValues) {
    const payload = {
      clientId: id,
      interviewedAt: new Date(values.interviewedAt).toISOString(),
      interviewedBy: values.interviewedBy,
      contactName: values.contactName.trim() || null,
      methodologyScore: Number(values.methodologyScore),
      teamScore: Number(values.teamScore),
      csatScore: Number(values.csatScore),
      npsScore: Number(values.npsScore),
      whatsGood: values.whatsGood.trim() || null,
      whatsToImprove: values.whatsToImprove.trim() || null,
    };

    if (editingCsat) {
      const id_ = editingCsat.id;
      await csatCollection.mutate(
        {
          type: "patch",
          id: id_,
          patch: {
            ...payload,
            updatedAt: new Date().toISOString(),
          },
        },
        async () => {
          const { data, error } = await supabase
            .from("CsatResponse")
            .update(payload)
            .eq("id", id_)
            .select("*, interviewer:Member!interviewedBy(id, name)")
            .single();
          if (error) throw new Error(error.message);
          return data as CsatResponseWithInterviewer;
        },
        {
          errorLabel: "Falha ao salvar entrevista",
          reconcile: (prev, result) =>
            prev.map((c) => (c.id === id_ ? result : c)),
        },
      );
    } else {
      const tempId = crypto.randomUUID();
      const optimistic: CsatResponseWithInterviewer = {
        id: tempId,
        clientId: id,
        interviewedAt: payload.interviewedAt,
        interviewedBy: payload.interviewedBy,
        contactName: payload.contactName,
        methodologyScore: payload.methodologyScore,
        teamScore: payload.teamScore,
        csatScore: payload.csatScore,
        npsScore: payload.npsScore,
        whatsGood: payload.whatsGood,
        whatsToImprove: payload.whatsToImprove,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        interviewer: payload.interviewedBy
          ? members.find((m) => m.id === payload.interviewedBy) ?? null
          : null,
      };
      await csatCollection.mutate(
        { type: "create", entity: optimistic },
        async () => {
          const { data, error } = await supabase
            .from("CsatResponse")
            .insert(payload)
            .select("*, interviewer:Member!interviewedBy(id, name)")
            .single();
          if (error) throw new Error(error.message);
          return data as CsatResponseWithInterviewer;
        },
        {
          errorLabel: "Falha ao registrar entrevista",
          reconcile: (prev, result) => [
            result,
            ...prev.filter((c) => c.id !== tempId),
          ],
        },
      );
    }
  }

  if (notFound) {
    return (
      <div className="space-y-4">
        <Link
          href="/clients"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Clientes
        </Link>
        <div className="surface p-8 text-center text-sm text-muted-foreground">
          Cliente não encontrado.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/clients"
          className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Clientes
        </Link>
      </div>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1 min-w-0">
          {loading || !client ? (
            <>
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-64" />
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold truncate">{client.name}</h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {client.email ? (
                  <a
                    href={`mailto:${client.email}`}
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {client.email}
                  </a>
                ) : null}
                {client.phone ? (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5" />
                    {client.phone}
                  </span>
                ) : null}
                {!client.email && !client.phone ? (
                  <span className="italic">Sem contato cadastrado</span>
                ) : null}
              </div>
            </>
          )}
        </div>
        {client && (
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={openEditClient}>
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Editar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={confirmDeleteClient}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Excluir
            </Button>
          </div>
        )}
      </header>

      {client?.notes ? (
        <div className="surface p-4 flex gap-3 text-sm">
          <StickyNote className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          <p className="whitespace-pre-wrap text-muted-foreground">
            {client.notes}
          </p>
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">
            Projetos
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {projects.length}
            </span>
          </h2>
        </div>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : projects.length === 0 ? (
          <div className="surface p-6 text-center text-sm text-muted-foreground">
            Este cliente ainda não tem projetos.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {projects.map((p) => (
              <ClientProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">
            CSAT
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {csatCollection.items.length}
            </span>
          </h2>
          <Button size="sm" onClick={openNewCsat}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Nova entrevista
          </Button>
        </div>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        ) : csatCollection.items.length === 0 ? (
          <div className="surface p-6 text-center text-sm text-muted-foreground">
            Nenhuma entrevista CSAT registrada.
            <br />
            <span className="text-xs">
              Clique em &ldquo;Nova entrevista&rdquo; quando coletar feedback do
              cliente.
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            {csatCollection.items.map((r) => (
              <CsatResponseCard
                key={r.id}
                response={r}
                onEdit={() => openEditCsat(r)}
                onDelete={() => confirmDeleteCsat(r)}
              />
            ))}
          </div>
        )}
      </section>

      <ResponsiveDialog open={editOpen} onOpenChange={setEditOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Editar Cliente</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="client-name">Nome</Label>
              <Input
                id="client-name"
                value={editForm.name}
                onChange={(e) =>
                  setEditForm({ ...editForm, name: e.target.value })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="client-email">Email</Label>
              <Input
                id="client-email"
                type="email"
                value={editForm.email}
                onChange={(e) =>
                  setEditForm({ ...editForm, email: e.target.value })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="client-phone">Telefone</Label>
              <Input
                id="client-phone"
                value={editForm.phone}
                onChange={(e) =>
                  setEditForm({ ...editForm, phone: e.target.value })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="client-notes">Notas</Label>
              <Textarea
                id="client-notes"
                rows={4}
                value={editForm.notes}
                onChange={(e) =>
                  setEditForm({ ...editForm, notes: e.target.value })
                }
              />
            </div>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={savingEdit}
            >
              Cancelar
            </Button>
            <Button
              onClick={saveClient}
              disabled={savingEdit || !editForm.name.trim()}
            >
              {savingEdit ? "Salvando…" : "Salvar"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <CsatResponseSheet
        open={csatOpen}
        onOpenChange={setCsatOpen}
        members={members}
        currentMemberId={currentMemberId}
        existing={editingCsat}
        onSubmit={submitCsat}
      />

      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </div>
  );
}
