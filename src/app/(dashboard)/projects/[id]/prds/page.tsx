import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { canViewProject } from "@/lib/dal";
import { db } from "@/lib/db";
import {
  getPrdsForProject,
  type PrdStatus,
  type ProductRequirementRow,
} from "@/lib/dal/product-requirements";
import { PageContainer } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";
import type { ChipTone } from "@/lib/status-chips";

export const dynamic = "force-dynamic";

const ALL_STATUS: PrdStatus[] = ["draft", "review", "approved", "superseded"];

function isPrdStatus(value: string): value is PrdStatus {
  return (ALL_STATUS as string[]).includes(value);
}

const STATUS_TONE: Record<PrdStatus, ChipTone> = {
  draft: "slate",
  review: "amber",
  approved: "green",
  superseded: "muted",
};

const STATUS_LABEL: Record<PrdStatus, string> = {
  draft: "Draft",
  review: "Em revisão",
  approved: "Aprovado",
  superseded: "Substituído",
};

function formatUpdated(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default async function ProjectPrdsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id: projectId } = await params;
  const { status: statusParam } = await searchParams;

  if (!(await canViewProject(projectId))) {
    redirect("/projects");
  }

  const supabase = db();
  const { data: project } = await supabase
    .from("Project")
    .select("id, name, referenceKey")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) notFound();

  const statusFilter: PrdStatus[] | undefined =
    statusParam && isPrdStatus(statusParam) ? [statusParam] : undefined;

  // Load filtered list (for table) and full list (for status counts).
  const [filtered, all]: [ProductRequirementRow[], ProductRequirementRow[]] =
    await Promise.all([
      getPrdsForProject(projectId, { status: statusFilter }),
      statusFilter
        ? getPrdsForProject(projectId)
        : Promise.resolve([] as ProductRequirementRow[]),
    ]);

  const allRows = statusFilter ? all : filtered;
  const counts: Record<PrdStatus, number> = {
    draft: 0,
    review: 0,
    approved: 0,
    superseded: 0,
  };
  for (const row of allRows) {
    if (isPrdStatus(row.status)) counts[row.status] += 1;
  }

  // Module names for the table.
  const moduleIds = Array.from(
    new Set(filtered.map((p) => p.moduleId).filter((x): x is string => !!x)),
  );
  const moduleNameById = new Map<string, string>();
  if (moduleIds.length > 0) {
    const { data: modules } = await supabase
      .from("Module")
      .select("id, name")
      .in("id", moduleIds);
    for (const m of modules ?? []) moduleNameById.set(m.id, m.name);
  }

  return (
    <PageContainer>
      <div className="flex flex-col gap-6 py-6">
        <div className="flex items-start gap-3">
          <Link
            href={`/projects/${projectId}`}
            aria-label={`Voltar para ${project.name}`}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <FileText className="size-5 text-muted-foreground" />
              <h1 className="text-2xl font-bold">PRDs do projeto</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Product Requirement Documents gerados pelo Vitor a partir das
              Design Sessions. Após aprovação, Vitoria materializa em Tasks.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/projects/${projectId}/prds`}
            className={
              !statusFilter
                ? "rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                : "rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            }
          >
            Todos ({allRows.length})
          </Link>
          {ALL_STATUS.map((s) => (
            <Link
              key={s}
              href={`/projects/${projectId}/prds?status=${s}`}
              className={
                statusFilter?.[0] === s
                  ? "rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                  : "rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
              }
            >
              {STATUS_LABEL[s]} ({counts[s]})
            </Link>
          ))}
        </div>

        {filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <FileText className="size-8 text-muted-foreground/60" />
              <p>
                Nenhum PRD ainda. O Vitor cria PRDs no step{" "}
                <code className="rounded bg-muted px-1 text-xs">briefing</code>{" "}
                da Design Session.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="p-0">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Reference</th>
                  <th className="px-4 py-3 font-semibold">Title</th>
                  <th className="px-4 py-3 font-semibold">Module</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const status: PrdStatus = isPrdStatus(row.status)
                    ? row.status
                    : "draft";
                  const moduleName = row.moduleId
                    ? moduleNameById.get(row.moduleId) ?? "—"
                    : "—";
                  return (
                    <tr
                      key={row.id}
                      className="border-b last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        <Link
                          href={`/projects/${projectId}/prds/${row.id}`}
                          className="hover:text-foreground"
                        >
                          {row.reference}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium">
                        <Link
                          href={`/projects/${projectId}/prds/${row.id}`}
                          className="hover:underline"
                        >
                          {row.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {moduleName}
                      </td>
                      <td className="px-4 py-3">
                        <StatusChip tone={STATUS_TONE[status]} dot>
                          {STATUS_LABEL[status]}
                        </StatusChip>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatUpdated(row.updatedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}

        {statusFilter ? (
          <div className="text-xs text-muted-foreground">
            <Badge variant="secondary">filter: {statusFilter[0]}</Badge>
          </div>
        ) : null}
      </div>
    </PageContainer>
  );
}
