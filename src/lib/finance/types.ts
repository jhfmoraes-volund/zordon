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
  sprintCount: number;
  engagementType: string | null; // continuous=squad · fixed_scope=encomenda
};

// ─── Contrato TEMPORAL (N por projeto, com vigência) ────────────────────────

export type BillingType = "squad" | "fixed_scope";

/**
 * Contrato por projeto, com vigência. N por projeto: sprints diferentes podem
 * rodar sob contratos diferentes (HITz: 1-3 contrato A, 4+ contrato B). Termos
 * (preço/FP, mensalidade, escopo, tipo) são POR CONTRATO. A fronteira é autorada
 * por sprint na UI mas guardada por data (`effectiveFrom`/`effectiveTo`).
 */
export type Contract = {
  id: string;
  projectId: string;
  label: string;
  seq: number;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null; // null = vigente
  billingType: BillingType;
  monthlyFeeCents: number | null; // mensalidade squad (gera receita via v_contract_revenue_month)
  totalValueCents: number | null; // encomenda: VALOR GLOBAL do contrato (campo aberto)
  pricePerFpCents: number | null; // DERIVADO (read-only): total_value ÷ contracted_fp (coluna GENERATED)
  contractedFp: number | null;
  contractedSprints: number | null;
  note: string | null;
  warranty: string | null; // P1 agent-fill (garantia)
  proposalRef: string | null; // vínculo à proposta (doc em contract_document)
  provenance: Record<string, unknown>; // P1 procedência por campo
};
export type ContractInput = {
  label: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  billingType: BillingType;
  monthlyFeeCents?: number | null;
  totalValueCents?: number | null; // encomenda: valor global (preço/FP é derivado, não entra no input)
  contractedFp?: number | null;
  contractedSprints?: number | null;
  note?: string | null;
  warranty?: string | null;
  proposalRef?: string | null;
};
export type ContractsResponse = { contracts: Contract[] };

/**
 * Período do contrato legível por quem vê o projeto (Slice 3 · view
 * finance.v_contract_period). SÓ período/identidade — NUNCA valores (RLS:
 * can_view_project OR is_admin). Edição segue admin-only (Q3).
 */
export type ContractPeriod = {
  contractId: string;
  projectId: string;
  label: string;
  seq: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  billingType: BillingType;
};
export type ContractPeriodsResponse = { periods: ContractPeriod[] };

// ─── Cláusulas do contrato (1-N; agent-fill + manual) ───────────────────────

export type ClauseKind = "sla" | "penalty" | "ip" | "confidentiality" | "readjust" | "warranty" | "other";
export type ContractClause = {
  id: string;
  contractId: string;
  kind: ClauseKind;
  text: string;
  sort: number;
  source: string;
};
export type ContractClauseInput = {
  contractId: string;
  kind?: ClauseKind;
  text: string;
  sort?: number;
};
export type ContractClausesResponse = { clauses: ContractClause[] };

// ─── Invoice / NF (cobrança operacional por mês; Q4: NÃO reconcilia receita) ──

export type InvoiceStatus = "pending" | "issued" | "received" | "cancelled";
export type InvoiceConditionKind = "pf_sheet" | "sow" | "none";
export type Invoice = {
  id: string;
  contractId: string;
  competenceMonth: string; // YYYY-MM-DD (1º dia)
  amountCents: number; // bruto
  receivedNetCents: number | null; // líquido na conta
  number: string | null;
  status: InvoiceStatus; // issued=NF emitida · received=pago · cancelled=fora dos rollups
  issuedAt: string | null;
  receivedAt: string | null;
  dueAt: string | null; // vencimento → aging
  conditionKind: InvoiceConditionKind | null;
  conditionMet: boolean;
  createdBy: string | null;
  provenance: Record<string, unknown>;
};
export type InvoiceInput = {
  contractId: string;
  competenceMonth: string;
  amountCents: number;
  receivedNetCents?: number | null;
  number?: string | null;
  status?: InvoiceStatus;
  issuedAt?: string | null;
  receivedAt?: string | null;
  dueAt?: string | null;
  conditionKind?: InvoiceConditionKind | null;
  conditionMet?: boolean;
};
export type InvoicesResponse = { invoices: Invoice[] };

/** Override de valor de um mês específico (substitui a mensalidade base só naquele mês). */
export type ContractMonthOverride = {
  id: string;
  contractId: string;
  month: string; // YYYY-MM-DD (1º dia)
  amountCents: number;
  note: string | null;
};
export type ContractMonthOverrideInput = {
  month: string;
  amountCents: number;
  note?: string | null;
};
export type ContractOverridesResponse = { overrides: ContractMonthOverride[] };

export type FpDelivery = {
  id: string;
  project_id: string;
  month: string;
  fp_delivered: number;
  note: string | null;
  created_at: string;
};
export type FpDeliveryInput = {
  month: string;
  fpDelivered: number;
  note?: string | null;
};
export type FpDeliveriesResponse = { deliveries: FpDelivery[] };

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

/** Membro pros selects/roster do app Finanças. */
export type MemberRef = {
  id: string;
  name: string;
  position: string | null;
  isExternal: boolean;
};

// ─── Alocação financeira de mão-de-obra (D12) ───────────────────────────────

export type Allocation = {
  id: string;
  member_id: string;
  project_id: string;
  percent: number;
  effective_from: string;
  effective_to: string | null;
  note: string | null;
  contract_id: string | null;
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
  contractId?: string | null;
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

/** Sprint enxuta pro cronograma de blocos + autoria da vigência por sprint. */
export type SprintLite = {
  id: string;
  name: string;
  startDate: string; // YYYY-MM-DD…
  endDate: string;
  status: string;
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
  sprints: SprintLite[]; // ordenadas por início (cronograma de blocos)
  sprintCount: number;
  engagementType: string | null;
  contracts: Contract[]; // todos os contratos do projeto, por vigência
  clauses: ContractClause[]; // cláusulas de todos os contratos (agrupar por contractId na UI)
  invoices: Invoice[]; // NFs de todos os contratos (operacional; Q4: NÃO toca receita)
  fpDeliveredTotal: number; // FP entregues no período
  fpRevenueCents: number; // receita de FP no período
  overheadCents: number; // custos indiretos por pessoa (premissas) no período
  dre: Dre;
  assumptions: Assumptions;
  assumptionsIsOverride: boolean;
};

// ─── Premissas (pricing/DRE) + DRE (decisões: global+override, híbrido) ─────

export type Assumptions = {
  id: string;
  projectId: string | null;
  issPct: number;
  pisPct: number;
  cofinsPct: number;
  sgaPct: number;
  financialCostPct: number;
  irpjCsllPct: number;
  targetMarginPct: number;
  hoursPerFte: number;
  aiPerFteCents: number;
  softwarePerHeadCents: number;
  equipCapexCents: number;
  equipLifeMonths: number;
};

/** Campos editáveis (sem id/projectId). */
export type AssumptionsInput = Omit<Assumptions, "id" | "projectId">;

export type AssumptionsResponse = {
  assumptions: Assumptions;
  isOverride: boolean;
};

/** Linhas da DRE (cascata da planilha P&L), em centavos. */
export type Dre = {
  faturamentoCents: number;
  impostosCents: number;
  receitaLiquidaCents: number;
  laborCents: number;
  overheadCents: number;
  directExpenseCents: number;
  custoDeliveryCents: number;
  custoFinanceiroCents: number;
  margemBrutaCents: number;
  sgaCents: number;
  lairCents: number;
  irpjCsllCents: number;
  lucroLiquidoCents: number;
  margemLiquidaPct: number | null;
};
