/**
 * Tipos do schema `finance`. Hand-authored porque o gerador
 * (scripts/update-db-types.sh) só cobre o schema `public` — ver
 * docs/features/finance/finance-app-plan.md §7. Mantidos em sincronia manual
 * com as migrations 20260622[b-e].
 */

export type FinanceKind = "revenue" | "expense";
export type Recurrence = "once" | "monthly" | "annual";

export type Category = {
  id: string;
  slug: string;
  kind: FinanceKind;
  name: string;
  recurring_default: boolean;
  requires_member: boolean;
  feeds_labor: boolean;
  sort: number;
  archived: boolean;
};

export type Entry = {
  id: string;
  category_id: string;
  project_id: string | null;
  member_id: string | null;
  amount_cents: number;
  recurrence: Recurrence;
  occurred_on: string | null;
  effective_from: string | null;
  effective_to: string | null;
  vendor: string | null;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// ─── Linhas de view (month = YYYY-MM-DD, 1º dia) ────────────────────────────

export type OrgMonthRow = {
  month: string;
  revenue_cents: number;
  expense_cents: number;
  net_cents: number;
};

export type CategoryMonthRow = {
  category_id: string;
  kind: FinanceKind;
  name: string;
  slug: string;
  month: string;
  amount_cents: number;
};

export type ProjectMonthRow = {
  project_id: string;
  month: string;
  revenue_cents: number;
  expense_cents: number;
  labor_cents: number;
  margin_direct_cents: number;
  margin_team_cents: number;
};

// ─── DTOs de API ────────────────────────────────────────────────────────────

export type CategoryTotal = {
  categoryId: string;
  slug: string;
  kind: FinanceKind;
  name: string;
  amountCents: number;
};

export type TeamCost = {
  compCents: number; // total comp no período
  allocatedCents: number; // alocado a projetos
  overheadCents: number; // não-alocado (overhead da operação)
};

export type OverviewResponse = {
  months: OrgMonthRow[];
  categories: CategoryTotal[];
  totals: { revenueCents: number; expenseCents: number; netCents: number };
  teamCost: TeamCost;
};

export type ProjectFinanceRow = {
  projectId: string;
  name: string;
  revenueCents: number;
  expenseCents: number;
  laborCents: number;
  marginDirectCents: number;
  marginTeamCents: number;
};

export type ProjectsResponse = { projects: ProjectFinanceRow[] };

// ─── Entry com rótulos (drill) + input de escrita ───────────────────────────

export type EntryListItem = Entry & {
  categoryName: string;
  categorySlug: string;
  categoryKind: FinanceKind;
  projectName: string | null;
  memberName: string | null;
};

export type EntryInput = {
  categoryId: string;
  projectId?: string | null;
  memberId?: string | null;
  amountCents: number;
  recurrence: Recurrence;
  occurredOn?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  vendor?: string | null;
  description?: string | null;
};

export type CategoriesResponse = { categories: Category[] };
export type EntriesResponse = { entries: EntryListItem[] };

// ─── Alocação financeira de mão-de-obra (D12) ───────────────────────────────

export type Allocation = {
  id: string;
  member_id: string;
  project_id: string;
  percent: number;
  effective_from: string;
  effective_to: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type AllocationItem = Allocation & {
  memberName: string;
  projectName: string;
};

export type AllocationInput = {
  memberId: string;
  projectId: string;
  percent: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  note?: string | null;
};

export type AllocationsResponse = { allocations: AllocationItem[] };

// ─── Detalhe por projeto (drill de análise) ─────────────────────────────────

export type ProjectMonthPoint = {
  month: string;
  revenue_cents: number;
  expense_cents: number;
  labor_cents: number;
  margin_direct_cents: number;
  margin_team_cents: number;
};

export type LaborByMember = {
  memberId: string;
  memberName: string;
  percent: number | null; // % vigente neste projeto (null se sem alocação ativa)
  laborCents: number; // custo no período
};

export type ProjectDetail = {
  projectId: string;
  name: string;
  months: ProjectMonthPoint[];
  totals: {
    revenueCents: number;
    expenseCents: number;
    laborCents: number;
    marginDirectCents: number;
    marginTeamCents: number;
  };
  laborByMember: LaborByMember[];
  allocations: AllocationItem[];
  squadMemberIds: string[];
};
