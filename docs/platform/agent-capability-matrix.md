# Matriz de capacidades dos agentes — GERADA (não editar à mão)

> Gerada de `src/lib/agent/tools-registry.ts` (descriptors) por `scripts/gen-capability-matrix.ts`.
> Regenere: `npx tsx --tsconfig tsconfig.eval.json scripts/gen-capability-matrix.ts --write docs/platform/agent-capability-matrix.md`.
> Pertencimento (`surfaces`) e escopo (`needs`) vivem no descriptor — esta tabela é projeção. Drift cross-repo: `scripts/check-daemon-surface.ts`.

**91 tools** · surfaces: vitor 41 · pm_review 17 · planning 23 · release_pl 27 · wiki 15 · alpha 26

| tool | class | needs | vitor | pm_review | planning | release_pl | wiki | alpha |
|------|-------|-------|----|----|----|----|----|----|
| `add_context_note` | act | planningId | · | · | ✓ | ✓ | · | · |
| `add_open_question` | act | sessionId | ✓ | · | · | · | · | · |
| `add_pm_review_note` | act | pmReviewId | · | ✓ | · | · | · | · |
| `add_task_comment` | act | — | · | · | ✓ | ✓ | · | · |
| `append_project_memory` | remember | — | · | · | ✓ | ✓ | · | · |
| `approve_prd` | act | — | ✓ | · | · | · | · | · |
| `ask_meeting` | sense | — | · | · | · | · | · | ✓ |
| `delete_proposed_action` | act | planningId | · | · | ✓ | ✓ | · | · |
| `describe_structured_source` | sense | — | ✓ | ✓ | ✓ | ✓ | · | ✓ |
| `get_alerts` | sense | — | · | · | · | · | · | ✓ |
| `get_allocated_project_members` | sense | — | · | · | · | · | · | ✓ |
| `get_backlog` | sense | — | · | · | · | · | · | ✓ |
| `get_dependency_graph` | sense | — | · | ✓ | ✓ | ✓ | ✓ | · |
| `get_meeting_transcript` | sense | — | · | · | · | · | · | ✓ |
| `get_pending_actions` | sense | — | · | · | · | · | · | ✓ |
| `get_planning_state` | sense | planningId | · | · | ✓ | ✓ | · | · |
| `get_project_capacity` | sense | routeProjectId | · | · | · | · | · | ✓ |
| `get_project_indicators` | sense | pmReviewId | · | ✓ | · | · | · | · |
| `get_recent_meetings` | sense | — | · | · | · | · | · | ✓ |
| `get_sprint_capacity` | sense | — | · | ✓ | ✓ | ✓ | ✓ | · |
| `get_sprint_overview` | sense | — | · | · | · | · | · | ✓ |
| `get_story` | sense | routeProjectId | · | · | · | · | · | ✓ |
| `get_task_detail` | sense | — | · | ✓ | ✓ | ✓ | ✓ | · |
| `get_tasks` | sense | — | · | · | · | · | · | ✓ |
| `glob_workspace` | act | — | ✓ | · | · | · | · | · |
| `grep_workspace` | act | — | ✓ | · | · | · | · | · |
| `link_context_source` | act | releasePlanningId | · | · | · | ✓ | · | · |
| `link_prd_dependency` | act | — | ✓ | · | · | · | · | · |
| `list_active_design_sessions` | sense | — | · | ✓ | ✓ | ✓ | ✓ | · |
| `list_context_sources` | sense | — | · | · | ✓ | ✓ | · | · |
| `list_decisions` | sense | sessionId | ✓ | · | · | · | · | · |
| `list_linked_sources` | sense | — | · | ✓ | · | · | · | · |
| `list_modules` | sense | routeProjectId | · | · | · | · | · | ✓ |
| `list_open_questions` | sense | sessionId | ✓ | · | · | · | · | · |
| `list_personas` | sense | routeProjectId | · | · | · | · | · | ✓ |
| `list_prds` | sense | — | ✓ | · | · | ✓ | · | · |
| `list_project_members` | sense | — | · | ✓ | ✓ | ✓ | ✓ | · |
| `list_project_sprints` | sense | — | · | ✓ | ✓ | ✓ | ✓ | · |
| `list_project_tasks` | sense | — | · | ✓ | ✓ | ✓ | ✓ | · |
| `list_sprints` | sense | — | · | · | · | · | · | ✓ |
| `list_stories` | sense | routeProjectId | · | · | · | · | · | ✓ |
| `list_unplanned_tasks` | sense | routeProjectId | · | · | · | · | · | ✓ |
| `load_heuristic` | sense | — | · | · | · | · | · | ✓ |
| `propose_prd` | act | sessionId | ✓ | · | · | · | · | · |
| `propose_story` | act | — | · | · | ✓ | ✓ | · | · |
| `propose_task_action` | act | planningId | · | · | ✓ | ✓ | · | · |
| `propose_task_bulk_update` | act | planningId | · | · | ✓ | ✓ | · | · |
| `propose_tasks` | act | planningId | · | · | ✓ | ✓ | · | · |
| `query_structured_source` | sense | — | ✓ | ✓ | ✓ | ✓ | · | ✓ |
| `read_brainstorm` | sense | sessionId | ✓ | · | · | · | · | · |
| `read_business_context` | sense | sessionId | ✓ | · | · | · | · | · |
| `read_context_source` | sense | — | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| `read_design_session_memory` | sense | — | · | ✓ | ✓ | ✓ | ✓ | · |
| `read_design_session_step` | sense | — | · | ✓ | ✓ | ✓ | ✓ | · |
| `read_gap` | sense | sessionId | ✓ | · | · | · | · | · |
| `read_hypothesis` | sense | sessionId | ✓ | · | · | · | · | · |
| `read_persona` | sense | sessionId | ✓ | · | · | · | · | · |
| `read_prd` | sense | — | ✓ | · | · | ✓ | · | · |
| `read_priority` | sense | sessionId | ✓ | · | · | · | · | · |
| `read_product_vision` | sense | sessionId | ✓ | · | · | · | · | · |
| `read_project_memory` | remember | sessionId | ✓ | · | · | · | · | · |
| `read_risk` | sense | sessionId | ✓ | · | · | · | · | · |
| `read_scope` | sense | sessionId | ✓ | · | · | · | · | · |
| `read_session_memory` | remember | sessionId | ✓ | · | · | · | · | · |
| `read_tech_specs` | sense | sessionId | ✓ | · | · | · | · | · |
| `read_transcript_content` | sense | — | · | ✓ | · | ✓ | · | · |
| `read_wiki` | sense | (routeProjectId\|projectId) | · | · | · | · | ✓ | ✓ |
| `read_workspace_file` | sense | — | ✓ | · | · | · | · | · |
| `recompose_wiki` | act | (routeProjectId\|projectId) | · | · | · | · | ✓ | ✓ |
| `record_decision` | act | sessionId | ✓ | · | · | · | · | · |
| `resolve_open_question` | act | sessionId | ✓ | · | · | · | · | · |
| `restore_wiki_bullet` | act | (routeProjectId\|projectId) | · | · | · | · | ✓ | ✓ |
| `revise_decision` | act | sessionId | ✓ | · | · | · | · | · |
| `set_wiki_emphasis` | act | (routeProjectId\|projectId) | · | · | · | · | ✓ | ✓ |
| `suppress_wiki_bullet` | act | (routeProjectId\|projectId) | · | · | · | · | ✓ | ✓ |
| `update_pm_review_report` | act | pmReviewId | · | ✓ | · | · | · | · |
| `update_prd` | act | — | ✓ | · | · | · | · | · |
| `update_project_memory` | remember | sessionId | ✓ | · | · | · | · | · |
| `update_proposed_action` | act | planningId | · | · | ✓ | ✓ | · | · |
| `update_session_memory` | remember | sessionId | ✓ | · | · | · | · | · |
| `update_task` | act | — | · | · | · | · | · | ✓ |
| `verify_sprint_distribution` | sense | routeProjectId | · | · | · | · | · | ✓ |
| `write_brainstorm` | act | sessionId | ✓ | · | · | · | · | · |
| `write_gap` | act | sessionId | ✓ | · | · | · | · | · |
| `write_hypothesis` | act | sessionId | ✓ | · | · | · | · | · |
| `write_persona` | act | sessionId | ✓ | · | · | · | · | · |
| `write_priority` | act | sessionId | ✓ | · | · | · | · | · |
| `write_product_vision` | act | sessionId | ✓ | · | · | · | · | · |
| `write_risk` | act | sessionId | ✓ | · | · | · | · | · |
| `write_scope_item` | act | sessionId | ✓ | · | · | · | · | · |
| `write_tech_specs` | act | sessionId | ✓ | · | · | · | · | · |

