"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormBody } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ConfirmDialog,
  type ConfirmState,
} from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { useClientContext } from "../_context/client-context";
import { LogoUploader } from "../_components/logo-uploader";

type Draft = {
  name: string;
  email: string;
  phone: string;
  notes: string;
};

function clientToDraft(c: {
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
}): Draft {
  return {
    name: c.name,
    email: c.email ?? "",
    phone: c.phone ?? "",
    notes: c.notes ?? "",
  };
}

export default function ClientSettingsPage() {
  const { client, loading, updateClient, deleteClient } = useClientContext();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // Hidrata o draft em render quando o client chega — só uma vez por cliente.
  // Evita useEffect + setState (lint react-hooks/set-state-in-effect).
  if (client && hydratedFor !== client.id) {
    setHydratedFor(client.id);
    setDraft(clientToDraft(client));
  }

  if (loading || !client || !draft) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  const dirty =
    draft.name.trim() !== client.name ||
    draft.email.trim() !== (client.email ?? "") ||
    draft.phone.trim() !== (client.phone ?? "") ||
    draft.notes.trim() !== (client.notes ?? "");

  async function handleSave() {
    if (!draft) return;
    if (!draft.name.trim()) return;
    setSaving(true);
    const updated = await updateClient({
      name: draft.name.trim(),
      email: draft.email.trim() || null,
      phone: draft.phone.trim() || null,
      notes: draft.notes.trim() || null,
    });
    setSaving(false);
    if (updated) {
      toast.success("Cliente atualizado.");
    }
  }

  function handleDelete() {
    const name = client?.name ?? "cliente";
    setConfirm({
      title: `Remover ${name}?`,
      description:
        "Esta ação remove o cliente e todos os dados vinculados (projetos, CSAT, oportunidades).",
      destructive: true,
      confirmLabel: "Excluir cliente",
      onConfirm: async () => {
        await deleteClient();
      },
    });
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Logo</h2>
        <LogoUploader />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Dados básicos</h2>
        <FormBody density="comfortable">
          <Field name="name" required>
            <Field.Label>Nome</Field.Label>
            <Field.Control>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field.Control>
          </Field>

          <Field.Row cols={2}>
            <Field name="email">
              <Field.Label>Email</Field.Label>
              <Field.Control>
                <Input
                  type="email"
                  value={draft.email}
                  onChange={(e) =>
                    setDraft({ ...draft, email: e.target.value })
                  }
                />
              </Field.Control>
            </Field>
            <Field name="phone">
              <Field.Label>Telefone</Field.Label>
              <Field.Control>
                <Input
                  value={draft.phone}
                  onChange={(e) =>
                    setDraft({ ...draft, phone: e.target.value })
                  }
                />
              </Field.Control>
            </Field>
          </Field.Row>

          <Field name="notes">
            <Field.Label>Notas</Field.Label>
            <Field.Control>
              <Textarea
                rows={4}
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </Field.Control>
          </Field>
        </FormBody>

        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saving || !dirty || !draft.name.trim()}
          >
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-destructive">Zona de risco</h2>
        <div className="surface border-destructive/40 p-4 flex items-center justify-between gap-3">
          <div className="text-sm">
            <p className="font-medium">Excluir cliente</p>
            <p className="text-muted-foreground">
              Remove o cliente e todos os dados vinculados. Não pode ser desfeito.
            </p>
          </div>
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Excluir
          </Button>
        </div>
      </section>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
