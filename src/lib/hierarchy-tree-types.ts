/**
 * Tipos puros da árvore hierárquica (Module → Story → Task).
 *
 * Mora fora de `src/lib/dal/` porque não tem "server-only" — é importado
 * tanto pela DAL (server) quanto pelos componentes React (client).
 */

export type HierarchyTaskNode = {
  id: string;
  reference: string | null;
  title: string;
  status: string;
  functionPoints: number | null;
  complexity: string;
  scope: string;
  acTechnicalCount: number;
  sprintId: string | null;
  /**
   * Como esta task entrou na árvore:
   *   • "committed" — task no escopo principal (DS task OU task da sprint da planning)
   *   • "eligible"  — task de backlog candidata (planning B mode; mesmo módulo, sem sprint)
   */
  membership: "committed" | "eligible";
};

export type HierarchyStoryNode = {
  id: string;
  reference: string;
  title: string;
  want: string;
  soThat: string | null;
  refinementStatus: string;
  persona: { id: string; name: string } | null;
  acProductCount: number;
  tasks: HierarchyTaskNode[];
};

export type HierarchyModuleNode = {
  key: string;
  moduleId: string | null;
  name: string;
  description: string | null;
  approved: boolean;
  approvedAt: string | null;
  stories: HierarchyStoryNode[];
};

export type HierarchyStats = {
  totalStories: number;
  totalTasks: number;
  committedTasks: number;
  eligibleTasks: number;
  draftTasks: number;
  totalFp: number;
  committedFp: number;
  eligibleFp: number;
  proposedModulesCount: number;
  approvedModulesCount: number;
};
