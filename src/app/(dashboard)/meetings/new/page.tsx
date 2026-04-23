"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft } from "lucide-react";

export default function NewMeetingPage() {
  const router = useRouter();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // NOTE: This POST intentionally stays as a fetch() call to the API route.
  // The server-side handler performs multi-step logic: fetching active projects,
  // creating the meeting with nested project reviews, and carrying over pending
  // action items from previous meetings. Moving this to supabase-js would
  // require replicating all that orchestration on the client.
  const create = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: `${date}T12:00:00`, notes }),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error("Erro ao criar reunião:", err);
        alert("Erro ao criar reunião. Verifique o console.");
        return;
      }
      const meeting = await res.json();
      router.push(`/meetings/${meeting.id}`);
    } catch (e) {
      console.error("Erro ao criar reunião:", e);
      alert("Erro ao criar reunião.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <div className="flex items-center gap-3">
        <Link href="/meetings">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Nova Reunião Semanal</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Todos os PMs e seus projetos ativos serão adicionados automaticamente.
        Ações pendentes de reuniões anteriores serão incluídas.
      </p>

      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label>Data da Reunião</Label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label>Notas Gerais (opcional)</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Observações gerais sobre a reunião..."
            rows={3}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={create} disabled={!date || saving}>
          {saving ? "Criando..." : "Criar Reunião"}
        </Button>
        <Link href="/meetings">
          <Button variant="outline">Cancelar</Button>
        </Link>
      </div>
    </div>
  );
}
