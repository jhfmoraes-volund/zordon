"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

type Meeting = {
  id: string;
  date: string;
  status: string;
  notes: string | null;
  projectReviews: {
    id: string;
    sprintHealth: string;
    project: { name: string };
    member: { name: string };
  }[];
  actionItems: {
    id: string;
    status: string;
    assignee: { name: string };
  }[];
};

const statusColors: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  done: "bg-green-100 text-green-800",
};

const statusLabels: Record<string, string> = {
  scheduled: "Agendada",
  in_progress: "Em andamento",
  done: "Concluída",
};

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const router = useRouter();

  const load = () => {
    fetch("/api/meetings").then((r) => r.json()).then(setMeetings);
  };

  useEffect(() => { load(); }, []);

  const remove = async (id: string) => {
    if (!confirm("Remover esta reunião?")) return;
    await fetch(`/api/meetings/${id}`, { method: "DELETE" });
    load();
  };

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString("pt-BR", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reuniões Semanais"
        description="Alinhamento semanal com PMs"
        onAdd={() => router.push("/meetings/new")}
        addLabel="Nova Reunião"
      />

      <div className="surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Projetos</TableHead>
              <TableHead>Ações</TableHead>
              <TableHead>Ações Pendentes</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {meetings.map((m) => {
              const pendingActions = m.actionItems.filter(
                (a) => a.status !== "done"
              ).length;
              return (
                <TableRow key={m.id} className="cursor-pointer">
                  <TableCell>
                    <Link
                      href={`/meetings/${m.id}`}
                      className="font-medium hover:underline"
                    >
                      {fmtDate(m.date)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={statusColors[m.status]}>
                      {statusLabels[m.status] || m.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{m.projectReviews.length}</TableCell>
                  <TableCell>{m.actionItems.length}</TableCell>
                  <TableCell>
                    {pendingActions > 0 ? (
                      <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                        {pendingActions} pendente{pendingActions > 1 ? "s" : ""}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(m.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {meetings.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground py-8"
                >
                  Nenhuma reunião registrada.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
