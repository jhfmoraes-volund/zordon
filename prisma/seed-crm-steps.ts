import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SESSION_ID = "cmngge9uk0004p3j0ve6xfmpv";

const steps = [
  {
    stepIndex: 3,
    stepKey: "prioritization",
    data: {
      items: [
        { id: "sol-1", title: "Captura automatica de leads", howItSolves: "Webhooks de formularios, Google Ads e Meta Ads alimentam o CRM automaticamente.", targetPersona: "Carolina", bucket: "mvp" },
        { id: "sol-2", title: "Pipeline visual (kanban)", howItSolves: "Visualizacao do status de cada lead em stages customizaveis.", targetPersona: "Rafael", bucket: "mvp" },
        { id: "sol-3", title: "Lead scoring baseado em engajamento", howItSolves: "Score automatico que prioriza leads quentes.", targetPersona: "Rafael", bucket: "mvp" },
        { id: "sol-6", title: "Lembretes e tarefas de follow-up", howItSolves: "Tarefa automatica de follow-up com notificacao.", targetPersona: "Rafael", bucket: "mvp" },
        { id: "sol-5", title: "Dashboard de ROI por campanha/canal", howItSolves: "Investimento vs retorno por canal.", targetPersona: "Carolina", bucket: "mvp" },
        { id: "sol-9", title: "Segmentacao de contatos por tags e listas", howItSolves: "Tags e filtros combinados para campanhas.", targetPersona: "Carolina", bucket: "mvp" },
        { id: "sol-10", title: "Importacao/exportacao CSV", howItSolves: "Migracao de planilhas com deteccao de duplicatas.", targetPersona: "Carolina", bucket: "mvp" },
        { id: "sol-4", title: "Automacao de nurturing", howItSolves: "Sequencias de e-mail automaticas por segmento.", targetPersona: "Carolina", bucket: "next" },
        { id: "sol-7", title: "Integracao WhatsApp Business", howItSolves: "WhatsApp direto do CRM com historico.", targetPersona: "Rafael", bucket: "next" },
        { id: "sol-8", title: "Relatorio executivo com funil e previsao", howItSolves: "Dashboard simplificado para CEO.", targetPersona: "Marcos", bucket: "next" },
        { id: "sol-11", title: "A/B testing de assunto de e-mail", howItSolves: "Testa versoes de assunto e envia vencedor.", targetPersona: "Carolina", bucket: "next" },
        { id: "sol-12", title: "Chatbot de qualificacao no site", howItSolves: "Widget de qualificacao automatica.", targetPersona: "Rafael", bucket: "out" },
      ],
    },
  },
  {
    stepIndex: 4,
    stepKey: "sequencing",
    data: {
      phases: [
        {
          id: "release-1",
          name: "Release 1 — Base + Pipeline (~7 dias)",
          items: [
            { id: "sol-2", title: "Pipeline visual (kanban)", targetPersona: "Rafael" },
            { id: "sol-10", title: "Importacao/exportacao CSV", targetPersona: "Carolina" },
            { id: "sol-9", title: "Segmentacao de contatos por tags e listas", targetPersona: "Carolina" },
            { id: "sol-6", title: "Lembretes e tarefas de follow-up", targetPersona: "Rafael" },
          ],
        },
        {
          id: "release-2",
          name: "Release 2 — Captura + Visibilidade (~7 dias)",
          items: [
            { id: "sol-1", title: "Captura automatica de leads", targetPersona: "Carolina" },
            { id: "sol-3", title: "Lead scoring baseado em engajamento", targetPersona: "Rafael" },
            { id: "sol-5", title: "Dashboard de ROI por campanha/canal", targetPersona: "Carolina" },
          ],
        },
      ],
    },
  },
  {
    stepIndex: 5,
    stepKey: "technical_specs",
    data: {
      stack: {
        frontend: "Next.js 16 + Tailwind CSS + shadcn/ui",
        backend: "API Routes Next.js + Prisma ORM",
        database: "SQLite (prototipo) → PostgreSQL (producao)",
        hosting: "Vercel (frontend) + Railway/Supabase (banco)",
      },
      integrations: [
        { name: "Google Ads API", purpose: "Captura automatica de leads de campanhas", priority: "release-2" },
        { name: "Meta Ads API", purpose: "Captura de leads do Instagram/Facebook", priority: "release-2" },
        { name: "Webhook generico", purpose: "Receber leads de formularios (Typeform, Google Forms, landing pages)", priority: "release-2" },
        { name: "WhatsApp Business API", purpose: "Envio/recebimento de mensagens", priority: "next" },
        { name: "SendGrid/Resend", purpose: "Envio de e-mails de nurturing", priority: "next" },
      ],
      constraints: [
        "Dados de leads sao sensiveis — criptografia em repouso e em transito",
        "LGPD: consentimento explicito, opcao de exclusao de dados",
        "Performance: dashboard deve carregar em <2s com ate 10k leads",
        "Mobile-first: SDRs acessam pelo celular durante visitas",
      ],
      architecture_notes: "Modelo de dados: Contact (lead), Company, Deal (oportunidade), Activity (interacao), Tag. Pipeline e uma view sobre Deal com stages configuraveis por projeto.",
    },
  },
  {
    stepIndex: 6,
    stepKey: "briefing",
    data: {
      summary: "CRM de Marketing para MarketPro Solutions. Foco em centralizar leads, automatizar captura de campanhas multicanal, e dar visibilidade de ROI. 3 personas: Gestora de Marketing (Carolina), SDR (Rafael) e CEO (Marcos). MVP em 2 releases de ~7 dias cada (15 dias total).",
      mvpScope: "Release 1: Pipeline kanban + CRUD contatos + importacao CSV + tags + follow-up. Release 2: Captura automatica (webhooks/ads) + lead scoring + dashboard ROI.",
      nextScope: "Automacao de nurturing por email, integracao WhatsApp Business, relatorio executivo com previsao, A/B testing de emails.",
      outOfScope: "Chatbot de qualificacao no site.",
      risks: [
        "Integracao com Google/Meta Ads pode ter limitacoes de API e custos",
        "Lead scoring precisa de volume minimo de dados para ser util",
        "LGPD exige cuidado no tratamento de dados pessoais",
      ],
      decisions: [
        "Pipeline usa 3 buckets (MVP/Next/Out) em vez de MoSCoW para agilizar priorizacao",
        "Sequenciamento em 2 releases (padrao da empresa: sprint de 15 dias)",
        "SQLite para prototipo, migrar para PostgreSQL em producao",
        "Mobile-first: SDRs sao os usuarios mais frequentes e usam celular",
      ],
    },
  },
];

async function main() {
  for (const step of steps) {
    const result = await prisma.designSessionStepData.upsert({
      where: {
        sessionId_stepKey: {
          sessionId: SESSION_ID,
          stepKey: step.stepKey,
        },
      },
      update: {
        stepIndex: step.stepIndex,
        data: JSON.stringify(step.data),
        updatedAt: new Date(),
      },
      create: {
        sessionId: SESSION_ID,
        stepIndex: step.stepIndex,
        stepKey: step.stepKey,
        data: JSON.stringify(step.data),
      },
    });
    console.log(`✓ Step ${step.stepIndex} (${step.stepKey}) saved — id: ${result.id}`);
  }

  // Update session to completed state at last step
  await prisma.designSession.update({
    where: { id: SESSION_ID },
    data: {
      currentStep: 6,
      status: "completed",
      completedAt: new Date(),
      actualDurationMin: 120,
    },
  });
  console.log("✓ Session marked as completed");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
