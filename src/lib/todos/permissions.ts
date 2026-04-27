import { getRoleLevel } from "@/lib/roles";

/**
 * Hierarquia de criação de To-dos:
 *  - Self: qualquer um cria pra si
 *  - PM (lvl 2): cria pra si + Builders (lvl 1)
 *  - CEO/Head Ops (lvl 3): cria pra si + PMs + Builders
 *
 * Regra: o criador pode atribuir a quem está em nível
 * estritamente abaixo do seu, ou a si mesmo.
 */
export function canCreateTodoFor(
  creator: { id: string; role: string | null | undefined },
  assignee: { id: string; role: string | null | undefined },
): boolean {
  if (creator.id === assignee.id) return true;
  return getRoleLevel(creator.role) > getRoleLevel(assignee.role);
}
