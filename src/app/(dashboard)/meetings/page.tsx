"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MEETING_STATUS, MEETING_TYPE, lookupChip, meetingStatusFromDate,
} from "@/lib/status-chips";
import { Pencil, Trash2 } from "lucide-react";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { fetchOrThrow } from "@/lib/optimistic/toast";
import { MeetingSheet, type MeetingEditInitial } from "@/components/meetings/meeting-sheet";
import { useAuth } from "@/contexts/auth-context";

type Meeting = {
  id: string;
  date: string;
  notes: string | null;
  type: "pm_review" | "general" | "daily" | "super_planning" | "private";
  title: string | null;
  createdById: string | null;
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
    memberId: string | null;
    member: { id: string; name: string } | null;
    externalName: string | null;
  }[];
  projectLinks: {
    project: { id: string; name: string } | null;
  }[];
};

function MeetingCardMobile({
  meeting,
  onEdit,
  onDelete,
  canEdit,
}: {
  meeting: Meeting;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
}) {
  const pendingActions = meeting.actionItems.filter((a) => a.status !== "done").length;
  const projectCount =
    meeting.type === "pm_review"
      ? meeting.projectReviews.length
      : meeting.projectLinks.length;
  const totalActions = meeting.actionItems.length;

  // Título explícito tem prioridade; se vazio, deriva do contexto.
  const titleText =
    meeting.title ||
    (meeting.type === "pm_review"
      ? meeting.attendees
          .filter((a) => a.member)
          .map((a) => a.member!.name)
          .join(", ") || null
      : meeting.type === "daily" || meeting.type === "super_planning"
        ? meeting.projectLinks
            .map((l) => l.project?.name)
            .filter(Boolean)
            .join(", ") || null
        : null);

  const shortDate = new Date(meeting.date).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });

  return (
    <div className="surface p-4 hover:bg-muted/30 transition-colors">
      <Link href={`/meetings/${meeting.id}`} className="block">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{shortDate}</span>
          <StatusChip {...lookupChip(MEETING_TYPE, meeting.type)} />
        </div>

        <p
          className={`mt-2 text-base font-medium line-clamp-2 ${
            titleText ? "" : "text-muted-foreground"
          }`}
        >
          {titleText || "Sem título"}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StatusChip
            {...lookupChip(MEETING_STATUS, meetingStatusFromDate(meeting.date))}
            dot
          />
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
      {canEdit && (
        <div className="mt-3 pt-3 border-t flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Editar reunião">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Remover reunião">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default function MeetingsPage() {
  const { member: currentMember, effectiveAccessLevel } = useAuth();
  const isBuilder = effectiveAccessLevel === "builder";
  // Edit/Delete are visible when:
  //  - manager+ created the meeting (or admin always), OR
  //  - builder created their own private meeting.
  // The server enforces this anyway; the UI just stays clean.
  const canEditMeetingRow = (m: Meeting): boolean => {
    if (!isBuilder) return true;
    return m.type === "private" && !!currentMember && m.createdById === currentMember.id;
  };

  const meetingsCollection = useOptimisticCollection<Meeting>([]);
  const meetings = meetingsCollection.items;
  const setMeetings = meetingsCollection.setCommitted;
  const meetingMutate = meetingsCollection.mutate;
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<"all" | "pm_review" | "general" | "daily" | "super_planning" | "private">("all");
  const [pmFilter, setPmFilter] = useState<string>("all");

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<"create" | "edit">("create");
  const [editingMeeting, setEditingMeeting] = useState<MeetingEditInitial | null>(null);

  const openCreate = () => {
    setSheetMode("create");
    setEditingMeeting(null);
    setSheetOpen(true);
  };

  const openEdit = (m: Meeting) => {
    setSheetMode("edit");
    setEditingMeeting({
      id: m.id,
      type: m.type,
      date: m.date,
      title: m.title,
      notes: m.notes,
      attendees: m.attendees.map((a) => ({
        memberId: a.memberId ?? a.member?.id ?? null,
        externalName: a.externalName ?? null,
        externalEmail: null,
        externalRole: null,
        role: a.role,
      })),
      projectLinks: m.projectLinks.map((l) => ({
        project: l.project ? { id: l.project.id } : null,
      })),
      projectReviews: m.projectReviews.map((r) => ({
        member: r.member ? { id: r.member.id } : null,
      })),
    });
    setSheetOpen(true);
  };

  const load = async () => {
    // Use API route (not direct Supabase) so impersonation/visibility filters apply.
    // Browser-side createClient() sends the real user's JWT, which bypasses
    // server-side impersonation context.
    try {
      const r = await fetch("/api/meetings");
      if (!r.ok) {
        setMeetings([]);
        return;
      }
      const data = await r.json();
      setMeetings(data as Meeting[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const remove = async (id: string) => {
    if (!confirm("Remover esta reunião?")) return;
    await meetingMutate(
      { type: "delete", id },
      async (signal) => {
        const res = await fetchOrThrow(`/api/meetings/${id}`, {
          method: "DELETE",
          signal,
        });
        return (await res.json().catch(() => ({}))) as { ok?: true };
      },
      {
        errorLabel: "Falha ao remover reunião",
        reconcile: (prev) => prev.filter((m) => m.id !== id),
      },
    );
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
        onAdd={openCreate}
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
              <SelectItem value="private">Privada</SelectItem>
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
        {loading &&
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="surface p-4 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        {!loading && filtered.length === 0 && (
          <div className="surface p-6 text-center text-sm text-muted-foreground">
            Nenhuma reunião registrada.
          </div>
        )}
        {filtered.map((m) => (
          <MeetingCardMobile
            key={m.id}
            meeting={m}
            onEdit={() => openEdit(m)}
            onDelete={() => remove(m.id)}
            canEdit={canEditMeetingRow(m)}
          />
        ))}
      </div>

      <MeetingSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        mode={sheetMode}
        meeting={editingMeeting}
        onSaved={() => {
          load();
        }}
      />

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
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((m) => {
              const pendingActions = m.actionItems.filter((a) => a.status !== "done").length;
              const projectCount =
                m.type === "pm_review" ? m.projectReviews.length : m.projectLinks.length;
              const titleCell =
                m.title ||
                (m.type === "pm_review"
                  ? m.attendees
                      .filter((a) => a.member)
                      .map((a) => a.member!.name)
                      .join(", ") || "—"
                  : m.type === "daily" || m.type === "super_planning"
                    ? m.projectLinks.map((l) => l.project?.name).filter(Boolean).join(", ") || "—"
                    : "—");
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
                    <StatusChip {...lookupChip(MEETING_TYPE, m.type)} />
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate text-sm text-muted-foreground">
                    {titleCell}
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      {...lookupChip(MEETING_STATUS, meetingStatusFromDate(m.date))}
                      dot
                    />
                  </TableCell>
                  <TableCell>{projectCount}</TableCell>
                  <TableCell>{m.actionItems.length}</TableCell>
                  <TableCell>
                    {pendingActions > 0 ? (
                      <StatusChip tone="amber">
                        {pendingActions} pendente{pendingActions > 1 ? "s" : ""}
                      </StatusChip>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {canEditMeetingRow(m) ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Editar reunião"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(m);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remover reunião"
                          onClick={(e) => {
                            e.stopPropagation();
                            remove(m.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {loading &&
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {!loading && filtered.length === 0 && (
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
