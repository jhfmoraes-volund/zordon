/**
 * zelar-persist-prework.ts — persiste os documentos Zelar em
 * DesignSessionStepData[pre_work].files[] pra que Vitor possa consultar
 * via get_step_data e search_doc em qualquer turno.
 *
 * One-shot. Se rodar de novo, ele REESCREVE o files[] (idempotente sobre nome de arquivo).
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../src/lib/db";

const SESSION_ID = "ae1c4107-14e3-4d6a-9b63-e2d0969691d5"; // Super Session Zelar
const INPUTS_DIR = join(__dirname, "..", "zelar-inputs");

const FILES = [
  { file: "zelar_regras_de_negocio.md", title: "Zelar — Regras de Negocio v1.2" },
  { file: "zelar_antibypass_v1_1.md", title: "Zelar — Anti-Bypass v1.1" },
  { file: "zelar_precificacao_matching_v1_1.md", title: "Zelar — Precificacao & Matching v1.1" },
  { file: "zelar_seguranca_v1_1.md", title: "Zelar — Seguranca v1.1" },
];

const STAKEHOLDERS_VISION = `Documento interno · Aurora / Beyond Company · Confidencial
Versão estratégica dos founders — projetos & ideias futuras (não-MVP, médio/longo prazo).

Premissa: nenhum dos projetos abaixo está fixado ou comprometido. São iniciativas que os founders
enxergam para médio/longo prazo, dependentes de validação, viabilidade técnica e alinhamento.

9 INICIATIVAS MAPEADAS — divididas em 3 grupos.

GRUPO 1: RECEITA & MONETIZAÇÃO
1.1 Ads & Parcerias no App [RECEITA ADICIONAL · PÓS-TRAÇÃO]
- Monetização do espaço de atenção via parcerias com marcas do ecossistema residencial.
- Banner contextual por categoria de serviço.
- Produtos sugeridos no pós-contratação.
- Loja de materiais no app (fase futura).
- Patrocínio de categoria por grandes marcas.

1.2 ZELAR Coin [ATIVO PRÓPRIO · PÓS-TRAÇÃO]
- Moeda interna com valor real. Inspiração: ABC da Construção.
- Coins gerados por serviços, avaliações e indicações.
- Resgate por produtos físicos, ferramentas e crédito.
- Integração com ABC da Construção e Fácil Locações.
- Estruturado como fidelidade — análise jurídica necessária.

1.3 Planos Zelar — B2C e B2B [RECORRÊNCIA · MVP + EXPANSÃO]
- 3 planos B2C: Essencial (R$19,90), Plus (R$49,90), Casa (R$129,90).
- 3 planos B2B: Síndico, Condomínio e White Label.
- Histórico digital da residência como barreira de troca.
- Loop B2B → B2C: condomínio vira canal de aquisição.

GRUPO 2: PARCERIAS ESTRATÉGICAS
2.1 ABC da Construção & Fácil Locações [IMEDIATO · acordo verbal firmado]
- Desconto e condições especiais em materiais e equipamentos.
- Relacionamento direto com os donos em Brasília.
- Reduz custo total: mão de obra + materiais + equipamentos.
- Expansão para loja no app e co-marketing.

2.2 Construtoras & Imobiliárias [B2B · PÓS-PILOTO]
- Limpeza pós-obra + manutenção contínua.
- LTV por parceiro estimado em R$50k–R$500k/ano.
- Kit entrega de imóvel: morador vira cliente com CAC zero.

2.3 Parceria com SENAI [IMEDIATO · acesso direto ao alto escalão]
- Captação de jovens profissionais recém-formados.
- SENAI forma 2,4 milhões de profissionais/ano em 2.700+ unidades.
- Fit direto: elétrica, hidráulica, climatização, pintura.
- Badge "Formado SENAI" gera confiança imediata do cliente.

GRUPO 3: ENGAJAMENTO & CRESCIMENTO DE PRESTADORES
3.1 Premiação por Serviços [RETENÇÃO · PODE INICIAR NO MVP]
- 10 serviços → Kit Zelar (camiseta, adesivo, pulseira).
- 100 serviços → Kit de ferramentas completo personalizado.
- 500 serviços → Evento presencial + equipamento premium.
- 5.000 serviços → Viagem custeada + Hall da Fama Zelar.

3.2 Educação Profissional [CAPACITAÇÃO · DESDE O INÍCIO]
- 4 frentes: técnica, comportamental, gestão e digital.
- Galpões físicos em Taguatinga — hub de treino.
- Cerimônias de certificação e evento anual top 10%.
- Educação como fonte de receita — cursos PRO e avulsos.

3.3 Programa de Liderança Z1–Z5 [CARREIRA · MÉDIO PRAZO]
- Z1 Iniciante → Z2 Intermediário → Z3 Premium → Z4 Líder de Região → Z5 Líder de Cidade.
- Score por 6 métricas extraídas automaticamente.
- Z4 recruta e treina — motor de expansão sem custo central.
- Z5: remuneração fixa + bônus sobre GMV + equity simbólico.

MENSAGEM DOS FOUNDERS — "Este é o projeto que escolhemos construir com vocês."
Transparência total: "agora somos sócios — e parceiro bom é parceiro alinhado."
9 projetos mapeados · 3 com acesso já aberto · ∞ potencial a explorar.
`;

function genId() {
  return Math.random().toString(36).slice(2, 9);
}

async function main() {
  // Build files array
  const files: Array<{
    id: string;
    name: string;
    size: number;
    type: string;
    extractedText: string;
  }> = [];

  for (const { file, title } of FILES) {
    const text = readFileSync(join(INPUTS_DIR, file), "utf-8");
    files.push({
      id: genId(),
      name: file,
      size: text.length,
      type: "text/markdown",
      extractedText: text,
    });
  }

  // Add the stakeholders vision (transcribed since PDF is image-only)
  files.push({
    id: genId(),
    name: "zelar_visao_stakeholders_transcrito.md",
    size: STAKEHOLDERS_VISION.length,
    type: "text/markdown",
    extractedText: STAKEHOLDERS_VISION,
  });

  // Read existing pre_work step data (might already have something)
  const { data: existing } = await db()
    .from("DesignSessionStepData")
    .select("data")
    .eq("sessionId", SESSION_ID)
    .eq("stepKey", "pre_work")
    .maybeSingle();

  const baseData = (existing?.data as Record<string, unknown>) || {};

  // Replace files; preserve other fields if any
  const newData = {
    ...baseData,
    files,
  };

  // Upsert (manual — table has separate "id" PK + UNIQUE on sessionId+stepKey)
  const existingRow = await db()
    .from("DesignSessionStepData")
    .select("id")
    .eq("sessionId", SESSION_ID)
    .eq("stepKey", "pre_work")
    .maybeSingle();

  let error;
  if (existingRow.data) {
    const res = await db()
      .from("DesignSessionStepData")
      .update({
        data: newData,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", existingRow.data.id);
    error = res.error;
  } else {
    const res = await db()
      .from("DesignSessionStepData")
      .insert({
        id: crypto.randomUUID(),
        sessionId: SESSION_ID,
        stepKey: "pre_work",
        stepIndex: 0,
        data: newData,
        updatedAt: new Date().toISOString(),
      });
    error = res.error;
  }

  if (error) {
    console.error("FATAL:", error);
    process.exit(1);
  }

  const totalChars = files.reduce((s, f) => s + f.size, 0);
  console.log(`✓ Persistido em DesignSessionStepData[${SESSION_ID}, pre_work].files`);
  console.log(`  ${files.length} arquivos, ${totalChars.toLocaleString()} chars totais`);
  for (const f of files) {
    console.log(`  - ${f.name} (${f.size.toLocaleString()} chars)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
