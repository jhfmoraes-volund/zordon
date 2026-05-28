# docs/

Documentação de planejamento, runbooks e specs do Volund. Organizado por domínio — cada pasta agrupa um tema.

> **Convenção:** `*-plan.md` = plano de implementação · `*-runbook.md` = passo-a-passo de execução · `prd-*.md` = PRD de produto. Versões superadas vão pra [`archive/`](archive/).

## Mapa

| Pasta | O que vive aqui |
|-------|-----------------|
| [`agents/`](agents/) | Agentes de IA. Runbook de criação de agentes + subpastas por agente. |
| [`agents/alpha/`](agents/alpha/) | **Alpha** (agente de ops): capacidades, calibrações, auditorias, roadmap. |
| [`agents/vitor/`](agents/vitor/) | **Vitor** (agente de Design Session): MCP, normalização, calibração, custo, auditorias. |
| [`features/`](features/) | Planos de feature de produto, por domínio. |
| [`features/design-session/`](features/design-session/) | Design Sessions — normalização e runbook. |
| [`features/story-hierarchy/`](features/story-hierarchy/) | Module → User Story → Task: plano, integração com Alpha, cleanup. |
| [`features/meetings/`](features/meetings/) | Reuniões/cerimônias — reorg, unificação com tasks, super-session. |
| [`features/sprints/`](features/sprints/) | Sprint lifecycle, planner, picker. |
| [`features/capacity/`](features/capacity/) | Modelo de capacity e sua unificação. |
| [`features/estimation/`](features/estimation/) | Estimativa: APF estimator, SP estimator, referência de Pontos de Função. |
| [`features/tasks/`](features/tasks/) | Tasks: dependências, referências por projeto, pipeline de conclusão, tags. |
| [`platform/`](platform/) | Padrões transversais: forms, optimistic updates, app shell, mobile/PWA, chat, workflow. |
| [`prd/`](prd/) | PRDs de produto. |
| [`runbooks/`](runbooks/) | Runbooks de tooling/skills: forge, audit-skill, sage. |
| [`apf-estimator/`](apf-estimator/) | Catálogo de funcionalidades, referencial e tabela PF do estimador APF. `medicoes/` guarda as planilhas. |
| [`task-gen/`](task-gen/) | Ferramenta de geração/auditoria de tasks (regras, playbooks, protocolos). |
| [`archive/`](archive/) | Planos superados e runbooks de migrações já concluídas. Mantidos pra histórico. |

## Referências canônicas (também citadas no [AGENTS.md](../AGENTS.md))

- Padrões de UI/forms/optimistic → [`platform/forms-standardization-plan.md`](platform/forms-standardization-plan.md), [`platform/optimistic-updates-runbook.md`](platform/optimistic-updates-runbook.md)
- Story hierarchy → [`features/story-hierarchy/story-hierarchy-plan.md`](features/story-hierarchy/story-hierarchy-plan.md)
- Sprint planner → [`features/sprints/sprint-planner-plan.md`](features/sprints/sprint-planner-plan.md)
- Geração de tasks → [`task-gen/`](task-gen/)
