/**
 * PRD Quick-Ask Generator — recebe brief do cliente e gera array de PRDs estruturados.
 * Single-shot, Haiku, JSON via generateObject. Chamado pela PRD Session (mode=quick_ask).
 *
 * Hard cap: 10 PRDs por chamada (D9).
 */

import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/provider";
import type { ParsedPrd } from "@/lib/sessions/prd-session/parser";

const HAIKU_MODEL = "anthropic/claude-haiku-4.5";
const MAX_PRDS = 10;

// ─── Schema do output ────────────────────────────────────────────────────────

// Anthropic structured outputs não suporta minItems/maxItems em arrays.
// Limites vivem no prompt + validação pós-call (clamp em generatePrdsFromBrief).
const prdItemSchema = z.object({
  title: z.string().describe(
    "Título do PRD em H1 (ex: 'Sistema de Autenticação', 'Feed de Posts'). Substantivo, não verbo. Mínimo 3 caracteres."
  ),
  oneLiner: z.string().describe(
    "Solução em uma frase — o que esta feature resolve e como. Máximo 2 frases."
  ),
  problem: z.string().describe(
    "Descrição do problema que motiva este PRD. 2-3 parágrafos contextualizando quem sofre, com qual frequência, qual o impacto."
  ),
  acceptanceCriteria: z.array(z.string()).describe(
    "Lista de critérios de aceitação verificáveis (ex: 'Login retorna JWT válido', 'Feed exibe posts dos últimos 7 dias'). Mínimo 3 itens."
  ),
  dependencies: z.array(z.string()).describe(
    "Array de títulos de outros PRDs (desta mesma lista) dos quais este PRD depende. Vazio se não depende de nenhum."
  ),
});

export const prdOutputSchema = z.object({
  prds: z.array(prdItemSchema).describe(
    `Array de PRDs gerados a partir do brief. Hard cap: ${MAX_PRDS} items (enforce no prompt).`
  ),
});

export type GeneratedPrds = z.infer<typeof prdOutputSchema>;
export type GeneratedPrd = z.infer<typeof prdItemSchema>;

// ─── Prompt ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é o PRD Generator — sub-agente especializado em transformar briefs curtos de clientes em PRDs estruturados e implementáveis.

## Sua missão

Receber um brief (1-3 parágrafos do cliente descrevendo o que ele quer) e gerar um **array de PRDs**, cada um representando um módulo/feature da solução proposta.

## Regras de geração

1. **Decomposição inteligente:** se o brief descreve um sistema complexo (ex: "clone do Instagram"), quebre em módulos técnicos coerentes (Auth, Feed, Stories, Profile, etc). Se o brief é simples (ex: "tela de login"), pode ser 1 PRD só.

2. **Hard cap de 10 PRDs** (D9). Se a solução precisar de mais, escolha os 10 módulos mais críticos (MVP) e adicione uma nota no \`problem\` do PRD raiz explicando o recorte.

3. **DAG de dependências:** preencha \`dependencies\` com títulos exatos de PRDs da mesma lista. Sem ciclos. Se A depende de B, B não pode depender de A (direta ou transitivamente).

4. **Critérios de aceitação verificáveis:** cada item de \`acceptanceCriteria\` deve ser objetivamente checável (não "boa UX", sim "botão de login exibe loading spinner durante autenticação").

5. **Problem grounded no brief:** toda afirmação no \`problem\` deve ter raiz no brief do cliente. Não invente dores que ele não citou. Se o brief é genérico ("clone X"), infira dores padrão do domínio (ex: "usuários precisam autenticar pra ver conteúdo privado").

6. **oneLiner como contrato:** essa frase vira a "Solução em uma frase" do PRD final. PM vai ler isso antes de abrir o PRD inteiro — precisa ser informativa, não vaga.

## Ordem de saída

Retorne os PRDs em **ordem topológica** (dependências primeiro). Exemplo: se "Feed" depende de "Auth", "Auth" vem antes de "Feed" no array.

## Anti-padrões (NÃO faça)

- **Não invente features** além do brief. Se o cliente não citou "notificações push", não crie PRD de notificações.
- **Não duplique** — cada PRD é um módulo distinto. "Auth" e "Login" não são dois PRDs, é um só.
- **Não crie dependências circulares** — valide mentalmente o DAG antes de gerar.
- **Não escreva AC genéricos** — "sistema funciona corretamente" não é AC válido.
- **Não ultrapasse ${MAX_PRDS} PRDs** — se precisar, priorize MVP.

## Saída

Devolva JSON conforme o schema fornecido. Array vazio é válido se o brief for incompreensível ou vazio (mas adicione warnings no sistema caso isso aconteça).`;

// ─── Função principal ────────────────────────────────────────────────────────

export async function generatePrdsFromBrief(brief: string): Promise<ParsedPrd[]> {
  if (!brief || brief.trim().length === 0) {
    throw new Error("Brief vazio — impossível gerar PRDs");
  }

  const result = await generateObject({
    model: getModel(HAIKU_MODEL),
    schema: prdOutputSchema,
    system: SYSTEM_PROMPT,
    prompt: `## Brief do cliente\n\n${brief.trim()}`,
  });

  // Clamp pós-call (Anthropic structured outputs não aceita maxItems no schema).
  const clamped = result.object.prds.slice(0, MAX_PRDS);

  // Converte GeneratedPrd[] → ParsedPrd[] (shape compatível com parser.ts)
  const parsedPrds: ParsedPrd[] = clamped.map((prd) => ({
    title: prd.title,
    oneLiner: prd.oneLiner,
    problem: prd.problem,
    acceptanceCriteria: prd.acceptanceCriteria,
    warnings: [], // quick-ask não gera warnings (PRD sempre estruturado)
  }));

  return parsedPrds;
}
