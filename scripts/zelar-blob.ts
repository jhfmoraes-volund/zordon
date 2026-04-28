/**
 * zelar-blob.ts — concatenate Zelar inputs into a single context blob
 * for the first message to Vitor on the Super Session.
 *
 * Output: /tmp/zelar-context.txt
 *
 * Note: o PDF "Visão dos stakeholders" e renderizado como imagem (sem texto
 * extraivel via pdf-parse). Transcrevo o conteudo manualmente abaixo.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const INPUTS_DIR = join(__dirname, "..", "zelar-inputs");
const OUT_PATH = "/tmp/zelar-context.txt";

const MD_FILES = [
  { file: "zelar_regras_de_negocio.md", title: "Regras de Negócio — Comportamento Esperado da Plataforma" },
  { file: "zelar_antibypass_v1_1.md", title: "Anti-Bypass — Como evitar que cliente e prestador fechem fora da plataforma" },
  { file: "zelar_precificacao_matching_v1_1.md", title: "Precificação & Matching — Como o algoritmo escolhe e cobra" },
  { file: "zelar_seguranca_v1_1.md", title: "Segurança — Verificação, fraude, dados e privacidade" },
];

const STAKEHOLDERS_VISION = `
Documento interno · Aurora / Beyond Company · Confidencial
Versão estratégica dos founders — projetos & ideias futuras (não-MVP, médio/longo prazo).

Premissa: nenhum dos projetos abaixo está fixado ou comprometido. São iniciativas que os founders
enxergam para médio/longo prazo, dependentes de validação, viabilidade técnica e alinhamento.

────────────────────────────────────────────────────────────────────────────────
9 INICIATIVAS MAPEADAS — divididas em 3 grupos.
────────────────────────────────────────────────────────────────────────────────

GRUPO 1: RECEITA & MONETIZAÇÃO (3 projetos)

1.1 Ads & Parcerias no App  [RECEITA ADICIONAL · PÓS-TRAÇÃO]
- Monetização do espaço de atenção da Zelar via parcerias contextualizadas com marcas
  do ecossistema residencial (tintas, ferramentas, materiais, etc.).
- Banner contextual por categoria de serviço.
- Produtos sugeridos no pós-contratação.
- Loja de materiais no app (fase futura).
- Patrocínio de categoria por grandes marcas.

1.2 ZELAR Coin  [ATIVO PRÓPRIO · PÓS-TRAÇÃO]
- Moeda interna com valor real. Prestadores e clientes acumulam coins e trocam por
  produtos e benefícios. Inspiração: ABC da Construção.
- Coins gerados por serviços, avaliações e indicações.
- Resgate por produtos físicos, ferramentas e crédito.
- Integração com ABC da Construção e Fácil Locações.
- Estruturado como fidelidade — análise jurídica necessária.

1.3 Planos Zelar — B2C e B2B  [RECORRÊNCIA · MVP + EXPANSÃO]
- Mensalidades para o cliente final + planos institucionais para condomínios.
  Transforma comissão volátil em receita recorrente com alto LTV.
- 3 planos B2C: Essencial (R$19,90), Plus (R$49,90), Casa (R$129,90).
- 3 planos B2B: Síndico, Condomínio e White Label.
- Histórico digital da residência como barreira de troca.
- Loop B2B → B2C: condomínio vira canal de aquisição.

────────────────────────────────────────────────────────────────────────────────

GRUPO 2: PARCERIAS ESTRATÉGICAS (3 projetos)

2.1 ABC da Construção & Fácil Locações  [PARCERIA COMERCIAL · IMEDIATO · acordo verbal firmado]
- Desconto e condições especiais em materiais e equipamentos para prestadores e
  clientes Zelar — serviço completo mais barato que qualquer alternativa do mercado.
- Relacionamento direto com os donos em Brasília.
- Reduz custo total: mão de obra + materiais + equipamentos.
- Prestador amplia os serviços que pode aceitar.
- Expansão para loja no app e co-marketing.

2.2 Construtoras & Imobiliárias  [B2B · PÓS-PILOTO]
- Zelar como fornecedora oficial para o mercado imobiliário — da limpeza pós-obra à
  manutenção contínua durante toda a vida útil do imóvel.
- Construtoras precisam de limpeza pós-obra em cada unidade.
- LTV por parceiro estimado em R$50k–R$500k/ano.
- Imobiliárias demandam manutenção contínua entre inquilinos.
- Kit entrega de imóvel: morador vira cliente com CAC zero.

2.3 Parceria com SENAI  [CAPTAÇÃO DE OFERTA · IMEDIATO · acesso direto ao alto escalão]
- Captação de jovens profissionais recém-formados do SENAI — técnica comprovada,
  sede de aplicar o conhecimento e sem os vícios do mercado informal.
- Mãe de founder tem contato direto com alto escalão.
- SENAI forma 2,4 milhões de profissionais/ano em 2.700+ unidades.
- Fit direto: elétrica, hidráulica, climatização, pintura.
- Badge "Formado SENAI" gera confiança imediata do cliente.

────────────────────────────────────────────────────────────────────────────────

GRUPO 3: ENGAJAMENTO & CRESCIMENTO DE PRESTADORES (3 projetos)

3.1 Premiação por Serviços  [RETENÇÃO · PODE INICIAR NO MVP]
- Marcos progressivos onde cada conquista do prestador é celebrada com uma recompensa
  tangível — inspirado nos modelos de premiação de gateways como Stone e Pagar.me.
- 10 serviços → Kit Zelar: camiseta, adesivo e pulseira.
- 100 serviços → Kit de ferramentas completo personalizado.
- 500 serviços → Evento presencial + equipamento premium.
- 5.000 serviços → Viagem custeada + Hall da Fama Zelar.

3.2 Educação Profissional  [CAPACITAÇÃO · DESDE O INÍCIO]
- Programa de qualificação em 4 frentes — criando uma vantagem competitiva que nenhum
  concorrente consegue replicar: corpo profissional capacitado, padronizado e leal.
- 4 frentes: técnica, comportamental, gestão e digital.
- Galpões físicos em Taguatinga — hub de treino e comunidade.
- Cerimônias de certificação e evento anual top 10%.
- Educação como fonte de receita — cursos PRO e avulsos.

3.3 Programa de Liderança Z1–Z5  [CARREIRA · MÉDIO PRAZO]
- Plano de carreira real dentro da plataforma com cinco níveis. Modelo de marketing
  multinível validado pelo mercado financeiro — referência direta na W1.
- Z1 Iniciante → Z2 Intermediário → Z3 Premium → Z4 Líder de Região → Z5 Líder de Cidade.
- Score por 6 métricas extraídas automaticamente da plataforma.
- Z4 recruta e treina — motor de expansão sem custo central.
- Z5: remuneração fixa + bônus sobre GMV + equity simbólico.

────────────────────────────────────────────────────────────────────────────────

MENSAGEM DOS FOUNDERS — "Este é o projeto que escolhemos construir com vocês."

A Zelar começou como uma ideia e evoluiu para um modelo estruturado, com proposta de valor
clara e um conjunto de projetos que enxergamos como caminhos reais de crescimento. Nenhum
nasce obrigatório ou urgente — todos têm seu tempo.

Transparência total: vocês precisam saber onde estivemos, o que pensamos e para onde
queremos ir. Porque agora somos sócios — e parceiro bom é parceiro alinhado.

9 projetos mapeados · 3 com acesso já aberto · ∞ potencial a explorar.
`;

async function main() {
  const sections: string[] = [];

  // Header
  sections.push(
    `# Zelar — Contexto consolidado para Vitor

Documento agregado a partir de 4 documentos de regras de negócio + 1 visão estratégica dos founders.
Confidencial. Aurora / Beyond Company.

`,
  );

  // Markdown docs
  for (const { file, title } of MD_FILES) {
    const content = readFileSync(join(INPUTS_DIR, file), "utf-8");
    sections.push(
      `\n\n========================================================================\n# ${title}\n# (arquivo: ${file})\n========================================================================\n\n${content.trim()}\n`,
    );
  }

  // Stakeholders vision (transcrito do PDF — PDF e image-only, sem texto extraivel)
  sections.push(
    `\n\n========================================================================\n# Visão Estratégica dos Founders — Projetos & Ideias Futuras\n# (transcricao do PDF "Visão dos stakeholders.pdf" — image-only, sem texto extraivel)\n========================================================================\n${STAKEHOLDERS_VISION}\n`,
  );

  const blob = sections.join("");
  writeFileSync(OUT_PATH, blob);

  // Stats
  const lines = blob.split("\n").length;
  const chars = blob.length;
  const tokensApprox = Math.round(chars / 4);
  console.log(`✓ Blob salvo em ${OUT_PATH}`);
  console.log(`  ${lines} linhas, ${chars.toLocaleString()} chars, ~${tokensApprox.toLocaleString()} tokens (estimado)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
