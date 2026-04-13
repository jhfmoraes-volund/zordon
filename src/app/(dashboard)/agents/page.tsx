"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Pencil, Trash2 } from "lucide-react";

type Agent = {
  id: string;
  name: string;
  model: string;
  costPerInputToken: number;
  costPerOutputToken: number;
  _count: { taskAssignments: number };
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [form, setForm] = useState({
    name: "", model: "", costPerInputToken: "0", costPerOutputToken: "0",
  });

  const load = () =>
    fetch("/api/agents").then((r) => r.json()).then(setAgents);

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", model: "", costPerInputToken: "0", costPerOutputToken: "0" });
    setOpen(true);
  };

  const openEdit = (a: Agent) => {
    setEditing(a);
    setForm({
      name: a.name,
      model: a.model,
      costPerInputToken: String(a.costPerInputToken),
      costPerOutputToken: String(a.costPerOutputToken),
    });
    setOpen(true);
  };

  const save = async () => {
    const body = {
      name: form.name,
      model: form.model,
      costPerInputToken: parseFloat(form.costPerInputToken) || 0,
      costPerOutputToken: parseFloat(form.costPerOutputToken) || 0,
    };
    if (editing) {
      await fetch(`/api/agents/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remover este agente?")) return;
    await fetch(`/api/agents/${id}`, { method: "DELETE" });
    load();
  };

  const formatCost = (cost: number) => {
    if (cost === 0) return "—";
    return `$${cost.toFixed(6)}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Agentes" onAdd={openNew} addLabel="Novo Agente" />

      <div className="surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Modelo</TableHead>
              <TableHead>$/input token</TableHead>
              <TableHead>$/output token</TableHead>
              <TableHead>Tasks</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.name}</TableCell>
                <TableCell className="font-mono text-sm">{a.model}</TableCell>
                <TableCell className="font-mono text-sm">{formatCost(a.costPerInputToken)}</TableCell>
                <TableCell className="font-mono text-sm">{formatCost(a.costPerOutputToken)}</TableCell>
                <TableCell>{a._count.taskAssignments}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(a)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(a.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {agents.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  Nenhum agente cadastrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Agente" : "Novo Agente"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Claude Sonnet 4" />
            </div>
            <div className="grid gap-2">
              <Label>Modelo</Label>
              <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="claude-sonnet-4" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Custo/input token ($)</Label>
                <Input type="number" step="0.000001" value={form.costPerInputToken} onChange={(e) => setForm({ ...form, costPerInputToken: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Custo/output token ($)</Label>
                <Input type="number" step="0.000001" value={form.costPerOutputToken} onChange={(e) => setForm({ ...form, costPerOutputToken: e.target.value })} />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={!form.name || !form.model}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
