# Zordon MCP — futuro (multi-user)

Os 4 PRDs aqui modelam a versão **completa** do Zordon MCP: repo separado, auth Bearer, telemetria, onboarding pra time. Foram congelados em 2026-06-01 quando decidimos atacar primeiro o MVP local (`prd-chat-via-claude-local`).

## Quando re-ativar

Reabrir esses PRDs quando:
- MVP local validar a UX (toggle + streaming + tools funcionando)
- Houver ≥ 2 PMs além do João querendo daemon
- Necessidade de tirar `SUPABASE_SERVICE_ROLE_KEY` do laptop

## Ordem original

1. [prd-zordon-mcp-extract.md](prd-zordon-mcp-extract.md) — extrai daemon + auth
2. [prd-chat-via-claude-daemon.md](prd-chat-via-claude-daemon.md) — chat via daemon multi-user
3. [prd-zordon-mcp-server.md](prd-zordon-mcp-server.md) — MCP server + tools dos 3 agentes
4. [prd-zordon-mcp-polish.md](prd-zordon-mcp-polish.md) — DX, telemetria, onboarding

## Substituído (pra MVP local) por

`docs/prd/backlog/prd-chat-via-claude-local.md` — versão enxuta, 13 stories, ~6h, só Zordon repo.
