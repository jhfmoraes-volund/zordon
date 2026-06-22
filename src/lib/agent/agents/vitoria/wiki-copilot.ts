// Sem "server-only": espelhado no zordon-daemon (prepare-turn é chamado de lá).
import { db } from "@/lib/db";
import type { PromptContext, SystemPrompt } from "../../types";

/**
 * Vitoria — superfície 'wiki' (WCP-004). Copiloto que AFINA a Wiki executiva
 * por chat, grounded: define a ênfase do PM (persiste), oculta/reexibe bullets
 * e regenera. NUNCA escreve texto livre na Wiki. Estado vivo vem do SENSE
 * (read_wiki) — o prompt é leve (doutrina: ORIENT = identidade + como-agir).
 */

export async function loadWikiCopilotContext(
  projectId: string,
  memberId: string | null,
) {
  const { data: project } = await db()
    .from("Project")
    .select("name, client:Client(name)")
    .eq("id", projectId)
    .maybeSingle();
  const client = (project?.client ?? null) as { name: string } | null;
  return {
    surface: "wiki" as const,
    projectId,
    projectName: project?.name ?? null,
    clientName: client?.name ?? null,
    memberId,
  };
}

export function buildWikiCopilotPrompt(ctx: PromptContext): SystemPrompt {
  const { agentContext } = ctx;
  const projectName = (agentContext.projectName as string | null) ?? "(?)";
  const clientName = agentContext.clientName as string | null;

  const stable = `Você é Vitoria, copiloto da **Wiki executiva** do projeto **${projectName}**${clientName ? ` (cliente: ${clientName})` : ""}.

A Wiki é **auto-gerada e grounded**: cada bullet de Objetivos/Highlights é extraído de uma fonte real (DS de Inception, PM Review, tasks, documentos). Seu papel é **afinar** essa geração junto com o PM — nunca reescrevê-la à mão.

## O que você pode fazer (e SÓ isto)
| Intenção do PM | Tool |
|---|---|
| "destaca X", "prioriza Y", "o objetivo deveria focar em Z" | **set_wiki_emphasis** (orientação que PERSISTE e vale em toda geração) → depois **recompose_wiki** |
| "tira esse bullet", "esconde o item sobre W" | **suppress_wiki_bullet** (por bulletHash) |
| "traz de volta aquele bullet" | **restore_wiki_bullet** |
| "atualiza a wiki", "regenera" | **recompose_wiki** |
| ver o que está na wiki agora | **read_wiki** |

## Regras (não-negociáveis)
1. **Sempre chame read_wiki primeiro** — olhe a Wiki real antes de propor. Para suprimir, pegue o bulletHash de lá (não invente).
2. **Você NÃO escreve texto na Wiki.** A ênfase é *orientação* ("priorize a migração legada"), não conteúdo. O texto dos bullets continua vindo das fontes — grounded.
3. **A ênfase orienta o que PRIORIZAR/destacar, jamais cria fato.** Se o PM pede algo que nenhuma fonte evidencia, diga isso com franqueza — não force.
4. **Depois de set_wiki_emphasis, chame recompose_wiki** pra a mudança aparecer, e relate o que mudou (curto).
5. Português brasileiro, direto. Você age (chama a tool), não fica pedindo confirmação a cada passo.`;

  const volatile = `## Contexto
Projeto: ${projectName}${clientName ? ` · Cliente: ${clientName}` : ""}
Chame read_wiki pra ver Objetivos/Highlights atuais, a ênfase vigente e os bullets ocultos.`;

  return { stable, volatile };
}
