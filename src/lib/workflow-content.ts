export type ContentBlock =
  | { type: "text"; body: string }
  | { type: "callout"; variant: "info" | "warning" | "tip"; body: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "steps"; items: { title: string; description: string }[] }
  | { type: "flow"; steps: { label: string; sub?: string }[] }
  | { type: "cards"; items: { title: string; summary: string; details?: string[]; badge?: string }[] }
  | { type: "code"; body: string };

export type WorkflowSection = {
  id: string;
  title: string;
  icon: string;
  summary: string;
  content: ContentBlock[];
};

export const workflowSections: WorkflowSection[] = [
  // ═══ 1. O Fluxo ═══
  {
    id: "fluxo",
    title: "O Fluxo",
    icon: "ArrowRight",
    summary: "Visao geral da esteira — do cliente a entrega.",
    content: [
      {
        type: "flow",
        steps: [
          { label: "Cliente", sub: "Demanda chega" },
          { label: "Projeto", sub: "Criado no Zordon" },
          { label: "Design Session", sub: "Inception ou CI" },
          { label: "Briefing", sub: "Consolidacao auto" },
          { label: "IA gera Tasks", sub: "Spec completa" },
          { label: "Sprint", sub: "15 dias" },
          { label: "Squad executa", sub: "Builders + Agentes" },
          { label: "Audit", sub: "Tech Specialist" },
          { label: "Entrega", sub: "Demo + Handoff" },
        ],
      },
      {
        type: "text",
        body: "Cada passo gera artefatos que alimentam o proximo. Nada e verbal — tudo fica registrado no Zordon. O ciclo se repete a cada sprint com uma Design Session de Melhoria Continua.",
      },
      {
        type: "callout",
        variant: "tip",
        body: "O diferencial da Volund e que a spec gerada pela Design Session e detalhada o suficiente para um agente IA executar sem reuniao adicional. Isso elimina o telefone-sem-fio entre PO e dev.",
      },
    ],
  },

  // ═══ 2. Design Sessions ═══
  {
    id: "design-sessions",
    title: "Design Sessions",
    icon: "Lightbulb",
    summary: "Reuniao estruturada que transforma ideia em spec executavel.",
    content: [
      {
        type: "text",
        body: "Uma Design Session captura requisitos e transforma em um briefing conciso que uma IA consegue consumir. Existem dois tipos:",
      },
      {
        type: "cards",
        items: [
          {
            title: "Inception",
            badge: "Projeto novo",
            summary: "Primeira session do projeto. 7 steps sequenciais que mapeiam do problema a solucao.",
            details: [
              "Visao do Produto — problema, quem sofre, metricas de sucesso",
              "Personas & Jornadas — AS-IS (como vive hoje) → TO-BE (como sera)",
              "Brainstorm — solution cards livres, sem filtro",
              "Priorizacao — classificar em MVP / Next / Out",
              "Sequenciamento — organizar MVP em fases/releases",
              "Specs Tecnicas — stack, integracoes, constraints",
              "Briefing — consolidacao automatica de todos os steps",
            ],
          },
          {
            title: "Melhoria Continua (CI)",
            badge: "Ciclos pos-entrega",
            summary: "Sessions de evolucao. Steps adaptados para novas demandas e melhorias.",
            details: [
              "Retrospectiva — o que funcionou, o que nao funcionou",
              "Novas Demandas — features do cliente ou time",
              "Repriorizacao — reordenar backlog",
              "Specs Tecnicas — ajustes de stack",
              "Briefing — consolidacao pra gerar novas tasks",
            ],
          },
        ],
      },
      {
        type: "callout",
        variant: "warning",
        body: "Toda mudanca de escopo passa por uma Design Session CI. Nao existe \"me adiciona isso aqui rapidinho\" fora do processo.",
      },
    ],
  },

  // ═══ 3. Do Briefing as Tasks ═══
  {
    id: "briefing-tasks",
    title: "Do Briefing as Tasks",
    icon: "Sparkles",
    summary: "Como a IA transforma o briefing em tasks com spec completa.",
    content: [
      {
        type: "steps",
        items: [
          { title: "PM clica \"Gerar Tasks\"", description: "No step de Briefing da Design Session." },
          { title: "Zordon envia pra IA", description: "Briefing completo + contexto do projeto + template de task." },
          { title: "IA retorna tasks", description: "Cada task com titulo, AC, tech notes, business context, scope, dependencies." },
          { title: "PM revisa em preview", description: "Pode editar qualquer campo, incluir ou excluir tasks." },
          { title: "PM confirma", description: "Tasks criadas no backlog do projeto com FP auto-sugerido." },
        ],
      },
      {
        type: "text",
        body: "O que torna isso diferente: a spec e completa o suficiente pra um agente IA executar sem perguntar nada. Acceptance criteria sao checklist verificavel. Technical notes tem codigo. Business context explica o porque.",
      },
      {
        type: "table",
        headers: ["Campo da spec", "O que contem", "Quem consome"],
        rows: [
          ["Acceptance Criteria", "Checklist de sim/nao verificavel", "Agente IA + PM (validacao)"],
          ["Technical Notes", "Queries, payloads, estrutura de dados", "Agente IA + Builder (review)"],
          ["Business Context", "Motivacao, persona, problema", "Agente IA (entende o porque)"],
          ["UI Guidance", "Layout, componentes, referencias visuais", "Agente IA + UI Builder"],
          ["Out of Scope", "O que NAO fazer", "Agente IA (evita over-engineering)"],
          ["Dependencies", "Tasks que precisam estar done antes", "PM (sequenciamento)"],
        ],
      },
    ],
  },

  // ═══ 4. Anatomia de uma Task ═══
  {
    id: "task-anatomy",
    title: "Anatomia de uma Task",
    icon: "FileText",
    summary: "Cada task e spec-driven — detalhada o suficiente pra execucao sem reuniao.",
    content: [
      {
        type: "cards",
        items: [
          { title: "setup", badge: "Roxo", summary: "Infraestrutura, config, CI/CD. Ex: Setup Next.js + Prisma." },
          { title: "feature", badge: "Azul", summary: "Funcionalidade de negocio. Ex: CRUD de Contatos." },
          { title: "component", badge: "Teal", summary: "Componente reutilizavel. Ex: DataTable, KanbanBoard." },
          { title: "seed", badge: "Ambar", summary: "Dados mock, populacao de banco." },
          { title: "bugfix", badge: "Vermelho", summary: "Correcao de bug." },
          { title: "refactor", badge: "Cinza", summary: "Melhoria tecnica sem mudanca funcional." },
          { title: "management", badge: "Rosa", summary: "Gestao, alinhamento, QA de aceite. Tasks do PM." },
        ],
      },
      {
        type: "flow",
        steps: [
          { label: "backlog" },
          { label: "todo" },
          { label: "in_progress" },
          { label: "review" },
          { label: "done" },
        ],
      },
      {
        type: "callout",
        variant: "info",
        body: "Tasks com mode \"agent\" sao executadas por IA. O agente recebe a spec como prompt e gera codigo. O output passa por review do builder + audit do Tech Specialist.",
      },
    ],
  },

  // ═══ 5. Sprints ═══
  {
    id: "sprints",
    title: "Sprints",
    icon: "Zap",
    summary: "Ciclos de 15 dias. Tasks distribuidas por dependencia, capacity e prioridade.",
    content: [
      {
        type: "table",
        headers: ["Aspecto", "Regra"],
        rows: [
          ["Duracao", "15 dias fixos (2 semanas uteis)"],
          ["Pertence a", "1 projeto"],
          ["Nomenclatura", "\"Sprint N\" (ex: Sprint 1, Sprint 2). Sem tema/sufixo."],
          ["Distribuicao", "Por dependencias → capacity → prioridade → due date"],
          ["Board", "Kanban com 8 colunas e drag-and-drop"],
          ["Meta", "FP planejados vs entregues (velocity)"],
        ],
      },
      {
        type: "text",
        body: "O PM nao deve alocar mais que 85% do capacity total do sprint. Se o backlog tem 300 FP e o sprint suporta 425 FP, as tasks excedentes ficam pro proximo sprint.",
      },
      {
        type: "code",
        body: "FP maximo do sprint = soma do capacity dos membros alocados\nAlocacao recomendada = FP maximo × 0.85 (buffer de 15%)\n\nExemplo:\n  Lucas (Fullstack):         150 FP\n  Camila (UI/UX Builder):    125 FP\n  Rafael (Backend/QA):       125 FP\n  Ana (PM):                   50 FP\n                              ─────\n  Capacity do sprint:         450 FP\n  Alocacao recomendada:       ~380 FP\n\n  Baseline squad Volund: 500 FP/sprint (15 dias)",
      },
    ],
  },

  // ═══ 6. Capacity ═══
  {
    id: "capacity",
    title: "Capacity & Function Points",
    icon: "Gauge",
    summary: "FP (Pontos de Funcao) e a metrica da Volund. Padrao IFPUG, faturavel, auditavel. Baseline: 500 FP/squad/sprint.",
    content: [
      {
        type: "text",
        body: "Na Volund, Function Points (FP) sao a metrica universal. Tudo se mede em FP: tasks, sprints, membros, projetos, faturamento. FP e padrao internacional (IFPUG/ISO), aceito em contratos e auditavel. Nosso objetivo e o Sweet Spot: estimar tasks com precisao E entender o quanto cada Volunder produz por sprint.",
      },
      {
        type: "callout",
        variant: "tip",
        body: "Baseline da Volund: um squad entrega 500 FP em 15 dias (1 sprint). Isso e o ponto de partida — a velocity real calibra ao longo dos sprints.",
      },
      {
        type: "table",
        headers: ["Role", "FP/sprint", "Notas"],
        rows: [
          ["UI/UX Builder", "125 FP", "Frontend, componentes, design system"],
          ["Backend/QA Builder", "125 FP", "APIs, logica, testes, integracoes"],
          ["Fullstack", "150 FP", "Maior versatilidade, range mais amplo"],
          ["Tech Specialist", "60 FP", "Foco em review e auditoria, nao volume"],
          ["PM", "50 FP", "Tasks de gestao, nao tecnicas"],
        ],
      },
      {
        type: "callout",
        variant: "info",
        body: "Calibracao: Sprint 1 mede velocity real (sem meta). Sprint 2-3 ajusta (velocity × 1.15). Sprint 4+ estabiliza com media movel dos ultimos 3 sprints.",
      },
      {
        type: "text",
        body: "Estimativa de FP por task — matrix scope × complexity baseada nos pesos IFPUG adaptados:",
      },
      {
        type: "table",
        headers: ["scope \\ complexity", "trivial", "low", "medium", "high"],
        rows: [
          ["micro", "3 FP", "4 FP", "5 FP", "7 FP"],
          ["small", "4 FP", "5 FP", "7 FP", "10 FP"],
          ["medium", "5 FP", "7 FP", "10 FP", "15 FP"],
          ["large", "7 FP", "10 FP", "15 FP", "21 FP"],
        ],
      },
      {
        type: "callout",
        variant: "tip",
        body: "Task-ancora: CRUD simples (listagem + create + edit + delete, 1 entidade, 5-6 campos, API + pagina) = 7 FP. Toda estimativa e relativa a essa ancora.",
      },
      {
        type: "text",
        body: "Multi-projeto: um Volunder pode estar em mais de 1 projeto. O Zordon cruza alocacao total. Regra: nenhum membro acima de 85%. Os 15% restantes cobrem bugs, reviews e context switching.",
      },
    ],
  },

  // ═══ 7. Pontos de Funcao ═══
  {
    id: "function-points",
    title: "Pontos de Funcao (FP)",
    icon: "Calculator",
    summary: "Metrica padrao (IFPUG/ISO) para dimensionar software. Usada para precificacao, contratos e benchmark de mercado.",
    content: [
      {
        type: "text",
        body: "Pontos de Funcao (PF/FP) medem o tamanho funcional do software do ponto de vista do usuario, independente de tecnologia. Na Volund, FP e a metrica unica — usada tanto para operacao interna (sprints, capacity, velocity) quanto para dimensionamento externo (contratos, precificacao, benchmark).",
      },
      {
        type: "callout",
        variant: "info",
        body: "Padrao internacional: IFPUG CPM 4.3.1, norma ISO/IEC 20926. Aceito em licitacoes, contratos gov e benchmarking global (ISBSG: 13.000+ projetos, 26 paises).",
      },
      {
        type: "cards",
        items: [
          {
            title: "ALI — Arquivo Logico Interno",
            badge: "Dados",
            summary: "Grupo de dados mantido (CRUD) pelo sistema.",
            details: [
              "Cada entidade com CRUD = 1 ALI",
              "Ex: Contact, Deal, Company, Tag",
              "Peso: Baixa 7 PF, Media 10 PF, Alta 15 PF",
              "Classificado por DET (campos) × RLR (subgrupos)",
            ],
          },
          {
            title: "AIE — Arquivo de Interface Externa",
            badge: "Dados",
            summary: "Grupo de dados lido de outro sistema, nao mantido.",
            details: [
              "O sistema so le, outro sistema mantem",
              "Ex: API Google Ads, API Meta Ads",
              "Peso: Baixa 5 PF, Media 7 PF, Alta 10 PF",
            ],
          },
          {
            title: "EE — Entrada Externa",
            badge: "Transacao",
            summary: "Processo que cria, altera ou deleta dados de um ALI.",
            details: [
              "Criar + Editar + Deletar = 3 EEs separadas",
              "Import CSV = 1 EE (mesmo que crie 1000 registros)",
              "Ex: criar contato, mover deal no kanban",
              "Peso: Baixa 3 PF, Media 4 PF, Alta 6 PF",
            ],
          },
          {
            title: "SE — Saida Externa",
            badge: "Transacao",
            summary: "Processo que gera dados derivados/calculados.",
            details: [
              "Processa/calcula/agrega antes de mostrar",
              "Ex: relatorio ROI, export CSV, dashboard com metricas",
              "Peso: Baixa 4 PF, Media 5 PF, Alta 7 PF",
            ],
          },
          {
            title: "CE — Consulta Externa",
            badge: "Transacao",
            summary: "Processo que recupera dados sem calculo.",
            details: [
              "Mostra dados como estao (SELECT simples)",
              "Ex: listar contatos, ver detalhe do deal",
              "Peso: Baixa 3 PF, Media 4 PF, Alta 6 PF",
              "Se tem calculo/derivacao → vira SE",
            ],
          },
        ],
      },
      {
        type: "table",
        headers: ["Tipo", "Baixa", "Media", "Alta"],
        rows: [
          ["ALI (dados internos)", "7 PF", "10 PF", "15 PF"],
          ["AIE (dados externos)", "5 PF", "7 PF", "10 PF"],
          ["EE (entrada)", "3 PF", "4 PF", "6 PF"],
          ["SE (saida calculada)", "4 PF", "5 PF", "7 PF"],
          ["CE (consulta simples)", "3 PF", "4 PF", "6 PF"],
        ],
      },
      {
        type: "callout",
        variant: "tip",
        body: "Contagem rapida NESMA: nao precisa classificar complexidade. Use peso fixo medio: ALI=7, AIE=5, EE=4, SE=5, CE=4. Margem de erro ~20% mas leva minutos.",
      },
      {
        type: "text",
        body: "Gearing factor pra stack Volund (QSM v5.0, 2.192 projetos reais):",
      },
      {
        type: "table",
        headers: ["Linguagem", "Media SLOC/PF", "Mediana", "Min", "Max", "Fonte"],
        rows: [
          ["JavaScript", "47", "53", "31", "63", "QSM v5.0"],
          ["TypeScript", "~47", "~53", "—", "—", "Estimado (superset JS)"],
          ["HTML/JSX", "34", "40", "14", "48", "QSM v5.0"],
          ["SQL/Prisma", "21", "21", "13", "37", "QSM v5.0"],
          ["Java", "53", "53", "14", "134", "QSM v5.0"],
          ["C#", "54", "59", "29", "70", "QSM v5.0"],
          ["Python", "~46", "—", "—", "—", "SPR/Capers Jones"],
          ["C", "97", "99", "39", "333", "QSM v5.0"],
        ],
      },
      {
        type: "callout",
        variant: "info",
        body: "1 Ponto de Funcao em JavaScript/TypeScript ≈ 47 linhas de codigo. Pra stack Next.js (mix de TS + JSX + SQL), o gearing factor efetivo fica em ~35-45 SLOC/PF.",
      },
      {
        type: "text",
        body: "Produtividade por contexto (horas por PF):",
      },
      {
        type: "table",
        headers: ["Contexto", "Horas/PF", "PF/pessoa-mes", "Referencia"],
        rows: [
          ["Media industria global", "~65 h", "~12", "QSM"],
          ["Web dev manual (pleno)", "8-12 h", "15-22", "ISBSG"],
          ["Web dev manual (senior)", "5-8 h", "22-35", "ISBSG"],
          ["Com agente IA", "2-5 h", "35-85", "ISBSG 2026"],
          ["Volund (estimativa)", "3-6 h", "30-60", "Interno"],
          ["Gov Brasil (licitacoes)", "8-15 h", "12-22", "Contratos publicos"],
        ],
      },
      {
        type: "text",
        body: "Na Volund, FP e a metrica unica. O gearing factor pra stack Next.js/TypeScript e ~35-45 SLOC/FP (media ponderada de JS + JSX + SQL). 1 FP ≈ 47 linhas de JavaScript (QSM v5.0).",
      },
      {
        type: "table",
        headers: ["Uso", "Metrica", "Quem consome"],
        rows: [
          ["Sprint planning, capacity, velocity, board", "Function Points (FP)", "PM, builders, squad"],
          ["Proposta comercial, contrato, precificacao", "Function Points (FP)", "Comercial, diretoria, cliente"],
          ["Benchmark de mercado, auditoria", "Function Points (FP)", "Diretoria, auditor externo"],
          ["Custo por unidade de software", "R$/FP", "Financeiro, comercial"],
        ],
      },
      {
        type: "callout",
        variant: "warning",
        body: "FP no sentido IFPUG puro nao conta tasks nao-funcionais (setup, CI/CD, refactoring, design system). Na Volund, atribuimos FP a essas tasks tambem via matrix scope × complexity, pra manter o modelo uniforme de capacity e faturamento.",
      },
    ],
  },

  // ═══ 8. Roles ═══
  {
    id: "roles",
    title: "Roles",
    icon: "Users",
    summary: "Squads pequenos (3-5 pessoas) que combinam humanos e agentes IA.",
    content: [
      {
        type: "cards",
        items: [
          {
            title: "Project Manager",
            badge: "PM",
            summary: "Coordena squad, alinha cliente, valida entregas. Nao coda.",
            details: [
              "Conduz dailies e remove bloqueios",
              "Alinha expectativas com o cliente",
              "Valida entregas contra criterios de aceite",
              "Planeja sprints por capacity",
              "Define prioridades que determinam ordem dos agentes",
            ],
          },
          {
            title: "UI/UX Builder",
            badge: "Frontend",
            summary: "Interface, componentes, design system. Valida output visual dos agentes.",
            details: [
              "Implementa componentes de UI e design system",
              "Escreve UI guidance nas specs para agentes",
              "Valida output visual gerado por agentes",
              "Componentes reutilizaveis viram blocos pro agente montar",
            ],
          },
          {
            title: "Backend/QA Builder",
            badge: "Backend",
            summary: "APIs, logica, integracoes. Escreve tech notes e faz review do agente.",
            details: [
              "Implementa APIs, models e logica",
              "Escreve technical notes que guiam os agentes",
              "Faz code review do output dos agentes",
              "Implementa integracoes e testes",
            ],
          },
          {
            title: "Fullstack",
            badge: "Coringa",
            summary: "End-to-end. Desbloqueia gargalos atuando em frontend ou backend.",
            details: [
              "Implementa features completas (API + UI)",
              "Assume tasks de UI ou backend conforme necessidade",
              "Define arquitetura e padroes",
              "Pode atuar em qualquer relacao com agentes",
            ],
          },
          {
            title: "Tech Specialist",
            badge: "Gate",
            summary: "Senior que audita codigo e faz homologacao final antes de producao.",
            details: [
              "Auditoria de codigo — review final de toda entrega",
              "Homologacao tecnica — gate de qualidade (seguranca, performance, padroes)",
              "Avalia output dos agentes IA com olho critico",
              "Define guidelines tecnicas que alimentam prompts dos agentes",
              "Nenhum codigo vai pra producao sem passar por ele",
            ],
          },
        ],
      },
    ],
  },

  // ═══ 8. Agentes IA ═══
  {
    id: "agentes",
    title: "Agentes IA",
    icon: "Bot",
    summary: "Modelos de IA que executam tasks automaticamente a partir da spec.",
    content: [
      {
        type: "flow",
        steps: [
          { label: "Task (mode: agent)", sub: "Spec completa" },
          { label: "Zordon monta prompt", sub: "AC + tech + UI" },
          { label: "Agente gera codigo", sub: "Claude / GPT-4" },
          { label: "TaskIteration", sub: "Resultado salvo" },
          { label: "Builder review", sub: "Code review" },
          { label: "Tech Specialist", sub: "Audit final" },
          { label: "Merge", sub: "Producao" },
        ],
      },
      {
        type: "text",
        body: "Quanto mais completa a spec, melhor o output do agente. Acceptance criteria dizem O QUE entregar. Technical notes dizem COMO implementar. UI guidance diz como PARECE. Out of scope diz o que NAO fazer.",
      },
      {
        type: "table",
        headers: ["Se o output falha", "Tipo de iteracao", "Trigger"],
        rows: [
          ["Humano pede mudanca no review", "revision", "review_feedback"],
          ["Conflito de merge automatico", "merge_fix", "merge_conflict"],
          ["Testes falham", "revision", "test_failure"],
        ],
      },
      {
        type: "callout",
        variant: "warning",
        body: "Cada iteracao e rastreada com: prompt enviado, tokens consumidos, resultado, custo. Isso permite medir a eficiencia dos agentes e otimizar prompts ao longo do tempo.",
      },
    ],
  },

  // ═══ 9. Nivel de Atencao ═══
  {
    id: "atencao",
    title: "Nivel de Atencao",
    icon: "AlertTriangle",
    summary: "Indicador automatico de saude do projeto. Calculado pelo Zordon.",
    content: [
      {
        type: "table",
        headers: ["Nivel", "Indicador", "Criterios"],
        rows: [
          ["Baixo", "Dot verde", "0 tasks atrasadas, sprint no ritmo"],
          ["Medio", "Dot amarelo", "1-3 tasks atrasadas OU sprint atrasado <20%"],
          ["Alto", "Dot vermelho", "4+ tasks atrasadas OU sprint atrasado >=20%"],
          ["Urgencia", "Dot vermelho pulsante", "Deadline <7 dias com progresso <80% OU membro >100%"],
        ],
      },
      {
        type: "text",
        body: "O PM ve o nivel de atencao na overview do projeto e na overview global. Nao precisa perguntar \"como esta o projeto?\" — o Zordon responde automaticamente com base nos dados reais.",
      },
    ],
  },

  // ═══ 10. Glossario ═══
  {
    id: "glossario",
    title: "Glossario",
    icon: "BookOpen",
    summary: "Termos e definicoes do universo Volund.",
    content: [
      {
        type: "table",
        headers: ["Termo", "Definicao"],
        rows: [
          ["Design Session", "Reuniao estruturada que captura requisitos"],
          ["Inception", "Primeira session de um projeto (7 steps)"],
          ["CI", "Design Session de ciclos subsequentes (Melhoria Continua)"],
          ["Briefing", "Documento consolidado gerado pela session"],
          ["Task", "Unidade de trabalho com spec completa"],
          ["FP (Function Points)", "Metrica padrao IFPUG de tamanho funcional. Usada pra capacity, faturamento e benchmark"],
          ["Sprint", "Ciclo de 15 dias de execucao"],
          ["Capacity", "FP que um membro entrega por sprint"],
          ["Velocity", "FP realmente entregues por sprint (medido, nao estimado)"],
          ["Sweet Spot", "Equilibrio entre estimativa precisa de FP e capacity real"],
          ["Spec-driven", "Task com spec suficiente pra execucao sem reuniao"],
          ["Gearing Factor", "Linhas de codigo por FP. JavaScript = 47 SLOC/FP (QSM v5.0)"],
          ["Task-ancora", "CRUD simples = 7 FP (referencia de calibracao)"],
          ["Volunder", "Membro do time Volund"],
          ["Agent", "Modelo de IA que executa tasks automaticamente"],
          ["Iteration", "Cada execucao de um agente em uma task"],
          ["Tech Specialist", "Senior que audita codigo antes de producao"],
          ["Attention Level", "Indicador automatico de saude do projeto"],
          ["Surface", "Padrao visual de containers no design system"],
        ],
      },
    ],
  },
];
