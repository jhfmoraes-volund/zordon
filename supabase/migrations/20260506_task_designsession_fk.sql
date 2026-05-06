-- Adiciona FK Task.designSessionId → DesignSession.id
--
-- Causa: a coluna existe mas a FK nunca foi declarada, então PostgREST não
-- consegue inferir o relacionamento. list_project_tasks (que faz JOIN
-- `designSession:DesignSession(title)`) falha com "Could not find a relationship
-- between 'Task' and 'DesignSession' in the schema cache".
--
-- Pre-flight (verificado via psql antes de aplicar): 0 tasks com
-- designSessionId apontando pra DesignSession inexistente.
--
-- ON DELETE SET NULL: tasks são preservadas se a session for deletada
-- (mantém histórico operacional intacto).

ALTER TABLE public."Task"
  ADD CONSTRAINT "Task_designSessionId_fkey"
  FOREIGN KEY ("designSessionId")
  REFERENCES public."DesignSession"(id)
  ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
