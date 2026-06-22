"use client";

/**
 * Superfície do app "Satisfação" (CSAT) no dock de Apps do cliente.
 *
 * É o corpo do antigo csat/page.tsx, movido para viver dentro do AppDesktop —
 * mesma lógica de CRUD/optimistic (useOptimisticCollection + CsatResponseCard/
 * Sheet + ConfirmDialog de delete). `members`/`currentMemberId` vêm do
 * useClientContext()/useAuth(). NÃO mudar a lógica — só onde o componente vive.
 *
 * CSAT escreve direto no Supabase (RLS permissiva — dívida conhecida, fora de
 * escopo). Mantido como está.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ConfirmDialog,
  type ConfirmState,
} from "@/components/ui/confirm-dialog";
import {
  CsatResponseSheet,
  type CsatFormValues,
} from "@/components/clients/csat-response-sheet";
import {
  CsatResponseCard,
  type CsatResponseWithInterviewer,
} from "@/components/clients/csat-response-card";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { useAuth } from "@/contexts/auth-context";
import { createClient } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/date-utils";
import { useClientContext } from "@/app/(dashboard)/clients/[id]/_context/client-context";

export function CsatApp({ clientId }: { clientId: string }) {
  const { members } = useClientContext();
  const { member } = useAuth();
  const currentMemberId = member?.id ?? null;
  const supabase = useMemo(() => createClient(), []);

  const csatCollection = useOptimisticCollection<CsatResponseWithInterviewer>(
    [],
  );

  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<CsatResponseWithInterviewer | null>(
    null,
  );
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("CsatResponse")
      .select("*, interviewer:Member!interviewedBy(id, name)")
      .eq("clientId", clientId)
      .order("interviewedAt", { ascending: false });
    csatCollection.setCommitted((data ?? []) as CsatResponseWithInterviewer[]);
    setLoading(false);
    // csatCollection.setCommitted is stable enough; clientId/supabase drive reload
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional data loading pattern
    void load();
  }, [load]);

  function openNew() {
    setEditing(null);
    setSheetOpen(true);
  }

  function openEdit(r: CsatResponseWithInterviewer) {
    setEditing(r);
    setSheetOpen(true);
  }

  function confirmDelete(r: CsatResponseWithInterviewer) {
    setConfirm({
      title: "Remover entrevista?",
      description: `Entrevista de ${fmtDate(r.interviewedAt)} será apagada.`,
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

  async function submit(values: CsatFormValues) {
    const payload = {
      clientId,
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

    if (editing) {
      const id_ = editing.id;
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
        clientId,
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

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">
          CSAT
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {csatCollection.items.length}
          </span>
        </h2>
        <Button size="sm" onClick={openNew}>
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
              onEdit={() => openEdit(r)}
              onDelete={() => confirmDelete(r)}
            />
          ))}
        </div>
      )}

      <CsatResponseSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        members={members}
        currentMemberId={currentMemberId}
        existing={editing}
        onSubmit={submit}
      />

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </section>
  );
}
