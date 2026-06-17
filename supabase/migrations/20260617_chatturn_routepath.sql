-- Alpha Fase 2 (route-scoping no daemon): persiste o `currentPath` (a página
-- onde o PM está) por turn de chat. O daemon não recebe o currentPath — o tool
-- router lê esta coluna do ChatTurn, faz parseRoute() e injeta
-- routeProjectId/routeSprintId no ctx das tools route-scoped (list_modules,
-- get_project_capacity, …). Nullable: turns sem rota (ou de outros agentes)
-- ficam globais. Ver docs/platform/alpha-daemon-plan.md §FASE 2.
ALTER TABLE "ChatTurn" ADD COLUMN IF NOT EXISTS "routePath" text;
