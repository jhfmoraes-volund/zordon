"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/page-header";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Trash2 } from "lucide-react";

type Meeting = {
  id: string;
  date: string;
  status: string;
  notes: string | null;
  type: "pm_review" | "general" | "daily" | "super_planning";
  title: string | null;
  projectReviews: {
    id: string;
    sprintHealth: string;
    project: { name: string };
    member: { id: string; name: string };
  }[];
  actionItems: {
    id: string;
    status: string;
    assignee: { name: string };
  }[];
  attendees: {
    id: string;
    role: string | null;
    member: { id: string; name: string } | null;
    externalName: string | null;
  }[];
  projectLinks: {
    project: { id: string; name: string } | null;
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

const typeLabels: Record<string, string> = {
  pm_review: "PMs",
  general: "Geral",
  daily: "Daily",
  super_planning: "Super Planning",
};

const typeColors: Record<string, string> = {
  pm_review: "bg-purple-100 text-purple-800",
  general: "bg-slate-100 text-slate-800",
  daily: "bg-cyan-100 text-cyan-800",
  super_planning: "bg-amber-100 text-amber-800",
};

function MeetingCardMobile({ meeting }: { meeting: Meeting }) {
  const pendingActions = meeting.actionItems.filter((a) => a.status !== "done").length;
  const projectCount =
    meeting.type === "pm_review"
      ? meeting.projectReviews.length
      : meeting.projectLinks.length;
  const totalActions = meeting.actionItems.length;

  const titleText =
    meeting.type === "pm_review"
      ? meeting.attendees
          .filter((a) => a.role === "pm" && a.member)
          .map((a) => a.member!.name)
          .join(", ") || null
      : meeting.type === "daily" || meeting.type === "super_planning"
        ? meeting.projectLinks
            .map((l) => l.project?.name)
            .filter(Boolean)
            .join(", ") || null
        : meeting.title;

  const shortDate = new Date(meeting.date).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });

  return (
    <Link
      href={`/meetings/${meeting.id}`}
      className="surface p-4 block hover:bg-muted/30 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{shortDate}</span>
        <Badge variant="secondary" className={`${typeColors[meeting.type]} text-xs`}>
          {typeLabels[meeting.type]}
        </Badge>
      </div>

      <p
        className={`mt-2 text-base font-medium line-clamp-2 ${
          titleText ? "" : "text-muted-foreground"
        }`}
      >
        {titleText || "Sem título"}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary" className={`${statusColors[meeting.status]} text-xs`}>
          {statusLabels[meeting.status] || meeting.status}
        </Badge>
        <span>
          {projectCount} {projectCount === 1 ? "projeto" : "projetos"} · {totalActions}{" "}
          {totalActions === 1 ? "to-do" : "to-dos"}
        </span>
        {pendingActions > 0 && (
          <span className="font-medium text-yellow-700 dark:text-yellow-500">
            ⚠ {pendingActions} pendente{pendingActions > 1 ? "s" : ""}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [typeFilter, setTypeFilter] = useState<"all" | "pm_review" | "general" | "daily" | "super_planning">("all");
  const [pmFilter, setPmFilter] = useState<string>("all");
  const router = useRouter();

  const load = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("Meeting")
      .select(`
        *,
        projectReviews:MeetingProjectReview(*, project:Project(name), member:Member(id, name)),
        actionItems:Todo(*, assignee:Member!Todo_assigneeId_fkey(name)),
        attendees:MeetingAttendee(id, role, externalName, member:Member(id, name)),
        projectLinks:MeetingProjectLink(project:Project(id, name))
      `)
      .order("date", { ascending: false });
    if (data) setMeetings(data as unknown as Meeting[]);
  };

  useEffect(() => { load(); }, []);

  const remove = async (id: string) => {
    if (!confirm("Remover esta reunião?")) return;
    const supabase = createClient();
    await supabase.from("Meeting").delete().eq("id", id);
    load();
  };

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString("pt-BR", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  // Collect all PMs that appear in any meeting (via reviews or attendees)
  const pmOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of meetings) {
      for (const r of m.projectReviews) {
        map.set(r.member.id, r.member.name);
      }
      for (const a of m.attendees) {
        if (a.role === "pm" && a.member) {
          map.set(a.member.id, a.member.name);
        }
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [meetings]);

  const filtered = meetings.filter((m) => {
    if (typeFilter !== "all" && m.type !== typeFilter) return false;
    if (pmFilter !== "all") {
      const hasPm =
        m.projectReviews.some((r) => r.member.id === pmFilter) ||
        m.attendees.some((a) => a.role === "pm" && a.member?.id === pmFilter);
      if (!hasPm) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reuniões"
        description="Reuniões com PMs e reuniões gerais"
        onAdd={() => router.push("/meetings/new")}
        addLabel="Nova reunião"
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3 sm:items-center">
        <div className="flex flex-col gap-1 sm:flex-row sm:gap-2 sm:items-center">
          <span className="text-sm text-muted-foreground">Tipo</span>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
            <SelectTrigger className="w-full h-9 sm:w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="pm_review">Reunião com PMs</SelectItem>
              <SelectItem value="general">Reunião geral</SelectItem>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="super_planning">Super Planning</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1 sm:flex-row sm:gap-2 sm:items-center">
          <span className="text-sm text-muted-foreground">PM</span>
          <Select value={pmFilter} onValueChange={(v) => v && setPmFilter(v)}>
            <SelectTrigger className="w-full h-9 sm:w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {pmOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Mobile: card list */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 && (
          <div className="surface p-6 text-center text-sm text-muted-foreground">
            Nenhuma reunião registrada.
          </div>
        )}
        {filtered.map((m) => (
          <MeetingCardMobile key={m.id} meeting={m} />
        ))}
      </div>

      {/* Desktop: table */}
      <div className="surface hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Título</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Projetos</TableHead>
              <TableHead>Ações</TableHead>
              <TableHead>Pendentes</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((m) => {
              const pendingActions = m.actionItems.filter((a) => a.status !== "done").length;
              const projectCount =
                m.type === "pm_review" ? m.projectReviews.length : m.projectLinks.length;
              const titleCell =
                m.type === "pm_review"
                  ? m.attendees
                      .filter((a) => a.role === "pm" && a.member)
                      .map((a) => a.member!.name)
                      .join(", ") || "—"
                  : m.type === "daily" || m.type === "super_planning"
                    ? m.projectLinks.map((l) => l.project?.name).filter(Boolean).join(", ") || "—"
                    : m.title || "—";
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
                    <Badge variant="secondary" className={typeColors[m.type]}>
                      {typeLabels[m.type]}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate text-sm text-muted-foreground">
                    {titleCell}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={statusColors[m.status]}>
                      {statusLabels[m.status] || m.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{projectCount}</TableCell>
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
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
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
