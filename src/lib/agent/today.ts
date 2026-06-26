/**
 * Bloco de âncora temporal "## Hoje" pros system prompts dos agentes.
 *
 * Por que existe (doutrina §14, anti-pattern de raciocínio temporal): agentes
 * que planejam por semana/sprint (Vitoria) ou interpretam "essa segunda",
 * "30/06", "semana passada" (Alpha) precisam de uma âncora EXPLÍCITA da data
 * corrente — senão chutam o ano por inferência do treino. Fonte única pra os
 * dois agentes não divergirem.
 *
 * Vai SEMPRE no bloco VOLÁTIL do prompt (não no estável/cacheado): a data muda
 * a cada dia. No daemon o prompt congela no 1º turn da sessão → a data fica
 * âncora do início da sessão (correta na prática; o valor é nunca chutar ano).
 * Timezone fixo em America/Sao_Paulo (operação Volund é BR).
 */
export function renderTodayBlock(): string {
  const now = new Date();
  const iso = now.toISOString().split("T")[0];
  const weekday = now.toLocaleDateString("pt-BR", {
    weekday: "long",
    timeZone: "America/Sao_Paulo",
  });
  const dateBR = now.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
  return [
    "## Hoje",
    `Data atual: **${iso}** — ${weekday}, ${dateBR}.`,
    'Use sempre essa data como âncora ao interpretar referências relativas ("hoje", "ontem", "essa segunda", "semana passada", "30/06" sem ano, etc). Nunca chute o ano por inferência — use o ano corrente acima.',
  ].join("\n");
}
