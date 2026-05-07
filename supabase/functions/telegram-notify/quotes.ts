// Motivational quote bank for daily-todo reminders. Four categories vary tone
// by slot (morning/evening) and load (clean inbox vs overdue items present).
// Kept in TS so each quote is a literal string — no fetch, no LLM, no cost.
//
// When picking, we hash the (slot + day-of-year + memberId) so the same user
// gets a stable quote within a day but doesn't repeat across consecutive
// days. The hash also avoids a "Math.random gave the same one twice" feel.

export type QuoteCategory =
  | "morning_clean"
  | "morning_overdue"
  | "evening_clean"
  | "evening_overdue";

const QUOTES: Record<QuoteCategory, string[]> = {
  morning_clean: [
    "Bom dia. A lista tá em dia — agora é só executar.",
    "Começa pela mais importante. As outras seguem.",
    "Pequeno avanço hoje vale mais que plano grande pra semana.",
    "Sem atrasadas, sem desculpa. Bora.",
    "Foco no que fecha hoje. Amanhã é outro problema.",
    "Tarefa começada é metade resolvida.",
    "Disciplina vence motivação. Hoje é dia de disciplina.",
    "Começa fácil. O resto desbloqueia.",
    "Dia limpo é privilégio — aproveita o ritmo.",
    "Ataca a mais chata primeiro. O resto vai voar.",
  ],
  morning_overdue: [
    "Bom dia. Tem coisa atrasada — encara as duas mais antigas antes do almoço.",
    "Atrasou, mas ainda dá. Começa pela mais velha.",
    "Cada atrasada custa o dobro pra cabeça. Resolve uma.",
    "Hoje é o dia de zerar o que ficou pra trás.",
    "Atrasada não some sozinha. Bora resolver.",
    "Lista atrasada drena energia mesmo fechada. Encurta ela.",
    "Fecha duas atrasadas hoje. Só duas. Já muda o dia.",
    "O que tava atrasado ontem não fica menor amanhã.",
    "Encara a pior primeiro. O alívio é proporcional.",
    "Dia bom começa com débito pago.",
  ],
  evening_clean: [
    "Boa noite. Dia em dia — fecha o laptop com orgulho.",
    "Lista limpa não é sorte, é constância. Continua amanhã.",
    "Hoje você venceu o jogo. Descansa de verdade.",
    "Dia produtivo merece noite leve. Vai descansar.",
    "Sem atrasada, sem ansiedade. Boa noite.",
    "Você fez o que tinha que fazer. Próxima.",
    "Encerra o dia. Amanhã recomeça do zero — e você tá pronto.",
    "Disciplina hoje é tranquilidade amanhã.",
    "Lista zerada, mente zerada. Boa noite.",
    "Esse é o ritmo. Mantém.",
  ],
  evening_overdue: [
    "Boa noite. Algumas dessas tão pedindo socorro — programa pra atacar amanhã cedo.",
    "Não vai dormir achando que vai sumir. Marca pra amanhã.",
    "Pendência acumulada vira ansiedade. Lista as 3 prioritárias e dorme.",
    "Aceita: hoje não foi. Amanhã encara cedo.",
    "Atrasada de hoje vira urgente de amanhã. Planeja agora.",
    "Olha o que ficou. Decide quais vão primeiro amanhã. Aí descansa.",
    "Procrastinar mais um dia custa caro. Prepara o ataque pra cedo.",
    "Não leva atrasada pra cama. Anota a primeira de amanhã e desliga.",
    "Reconhece o que ficou pra trás — sem drama. Amanhã resolve.",
    "Fecha o dia listando o que vai fazer primeiro amanhã. É o suficiente.",
  ],
};

// Tiny non-crypto hash so we can pick deterministically per user/day without
// any imports. djb2 is fine for this — we just need consistent buckets.
function djb2(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function pickQuote(
  category: QuoteCategory,
  seed: string,
): string {
  const list = QUOTES[category];
  const idx = djb2(seed) % list.length;
  return list[idx];
}
