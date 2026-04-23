# Pontos de Funcao (FP) — Referencia Completa

> Base de conhecimento sobre Analise de Pontos de Funcao (APF/FPA).
> Baseado no IFPUG CPM 4.3.1 (padrao internacional).

---

## 1. O que sao Pontos de Funcao

Pontos de Funcao (PF) e uma metrica que mede o **tamanho funcional** de um software do ponto de vista do usuario. Nao mede linhas de codigo, complexidade tecnica ou esforco — mede **o que o software faz**.

Criado por Allan Albrecht (IBM, 1979). Padronizado pelo IFPUG (International Function Point Users Group). Usado globalmente em contratos, licitacoes, benchmarking e estimativa de custo.

**Principio fundamental:** dois sistemas que fazem a mesma coisa pro usuario tem o mesmo tamanho em PF, independente de serem escritos em Java, Python, Next.js ou COBOL.

---

## 2. Os 5 tipos de funcao

Toda funcionalidade de software se enquadra em 1 de 5 tipos:

### 2.1 Funcoes de dados (o que o sistema armazena)

| Tipo | Sigla | Definicao | Exemplo |
|------|-------|-----------|---------|
| **Arquivo Logico Interno** | ALI | Grupo de dados mantido (CRUD) pelo sistema | Tabela Contact, Deal, Company |
| **Arquivo de Interface Externa** | AIE | Grupo de dados lido de outro sistema, nao mantido | Dados do Google Ads API, lista de CEPs dos Correios |

**Diferenca chave:** ALI = o sistema cria/altera/deleta os dados. AIE = o sistema so le, outro sistema mantem.

### 2.2 Funcoes transacionais (o que o sistema faz)

| Tipo | Sigla | Definicao | Exemplo |
|------|-------|-----------|---------|
| **Entrada Externa** | EE | Processo que mantem (cria/altera/deleta) dados de um ALI | Criar contato, importar CSV, mover deal no kanban |
| **Saida Externa** | SE | Processo que gera dados derivados/calculados pra fora do sistema | Relatorio de ROI, export CSV, dashboard com agregacoes |
| **Consulta Externa** | CE | Processo que recupera dados sem calculo/derivacao | Listar contatos, buscar por tag, ver detalhe do deal |

**Diferenca chave entre SE e CE:**
- CE = mostra dados como estao (SELECT simples)
- SE = processa/calcula/agrega antes de mostrar (SUM, AVG, JOIN complexo, formatacao)

---

## 3. Elementos de contagem

Cada funcao e classificada por complexidade usando dois elementos:

### Para ALI e AIE:

| Elemento | Sigla | O que e |
|----------|-------|---------|
| **Tipo de Dado Elementar** | DET | Campo reconhecido pelo usuario (coluna da tabela, campo do form) |
| **Tipo de Registro Logico** | RLR | Subgrupo de dados dentro do ALI/AIE (tabela principal + tabelas filhas obrigatorias) |

### Para EE, SE e CE:

| Elemento | Sigla | O que e |
|----------|-------|---------|
| **Tipo de Dado Elementar** | DET | Campo que entra ou sai na transacao |
| **Arquivo Logico Referenciado** | ALR | Quantidade de ALI/AIE lidos ou mantidos pela transacao |

---

## 4. Tabelas de complexidade

### 4.1 ALI (Arquivo Logico Interno)

| DET \ RLR | 1 RLR | 2-5 RLR | 6+ RLR |
|-----------|-------|---------|--------|
| 1-19 DET | Baixa | Baixa | Media |
| 20-50 DET | Baixa | Media | Alta |
| 51+ DET | Media | Alta | Alta |

**Pesos:**

| Complexidade | PF |
|-------------|-----|
| Baixa | 7 |
| Media | 10 |
| Alta | 15 |

### 4.2 AIE (Arquivo de Interface Externa)

| DET \ RLR | 1 RLR | 2-5 RLR | 6+ RLR |
|-----------|-------|---------|--------|
| 1-19 DET | Baixa | Baixa | Media |
| 20-50 DET | Baixa | Media | Alta |
| 51+ DET | Media | Alta | Alta |

**Pesos:**

| Complexidade | PF |
|-------------|-----|
| Baixa | 5 |
| Media | 7 |
| Alta | 10 |

### 4.3 EE (Entrada Externa)

| DET \ ALR | 0-1 ALR | 2 ALR | 3+ ALR |
|-----------|---------|-------|--------|
| 1-4 DET | Baixa | Baixa | Media |
| 5-15 DET | Baixa | Media | Alta |
| 16+ DET | Media | Alta | Alta |

**Pesos:**

| Complexidade | PF |
|-------------|-----|
| Baixa | 3 |
| Media | 4 |
| Alta | 6 |

### 4.4 SE (Saida Externa)

| DET \ ALR | 0-1 ALR | 2-3 ALR | 4+ ALR |
|-----------|---------|---------|--------|
| 1-5 DET | Baixa | Baixa | Media |
| 6-19 DET | Baixa | Media | Alta |
| 20+ DET | Media | Alta | Alta |

**Pesos:**

| Complexidade | PF |
|-------------|-----|
| Baixa | 4 |
| Media | 5 |
| Alta | 7 |

### 4.5 CE (Consulta Externa)

| DET \ ALR | 0-1 ALR | 2-3 ALR | 4+ ALR |
|-----------|---------|---------|--------|
| 1-5 DET | Baixa | Baixa | Media |
| 6-19 DET | Baixa | Media | Alta |
| 20+ DET | Media | Alta | Alta |

**Pesos:**

| Complexidade | PF |
|-------------|-----|
| Baixa | 3 |
| Media | 4 |
| Alta | 6 |

---

## 5. Resumo de pesos (tabela rapida)

| Tipo | Baixa | Media | Alta |
|------|-------|-------|------|
| ALI | 7 | 10 | 15 |
| AIE | 5 | 7 | 10 |
| EE | 3 | 4 | 6 |
| SE | 4 | 5 | 7 |
| CE | 3 | 4 | 6 |

---

## 6. Calculo dos Pontos de Funcao Nao-Ajustados (PFNA)

```
PFNA = Σ(ALI × peso) + Σ(AIE × peso) + Σ(EE × peso) + Σ(SE × peso) + Σ(CE × peso)
```

### Exemplo: CRM de Marketing

**ALIs identificados:**

| ALI | DET | RLR | Complexidade | PF |
|-----|-----|-----|-------------|-----|
| Contact | 12 (firstName, lastName, email, phone, source, score, ...) | 2 (Contact + ContactTag) | Baixa | 7 |
| Company | 6 (name, website, industry, size, notes, ...) | 1 | Baixa | 7 |
| Deal | 8 (title, value, contactId, stageId, ownerId, closedAt, ...) | 1 | Baixa | 7 |
| PipelineStage | 6 (name, position, color, isClosedWon, ...) | 1 | Baixa | 7 |
| Activity | 8 (type, subject, description, contactId, dealId, ...) | 1 | Baixa | 7 |
| Tag | 3 (name, color) | 1 | Baixa | 7 |
| Campaign | 6 (name, source, totalSpent, startDate, endDate) | 1 | Baixa | 7 |
| LeadCapture | 5 (contactId, campaignId, channel, rawPayload, capturedAt) | 1 | Baixa | 7 |
| FollowUp | 7 (contactId, dealId, userId, dueDate, note, status, ...) | 1 | Baixa | 7 |
| User | 5 (name, email, avatarUrl, role) | 1 | Baixa | 7 |
| **Subtotal ALI** | | | | **70** |

**AIEs identificados:**

| AIE | DET | RLR | Complexidade | PF |
|-----|-----|-----|-------------|-----|
| Google Ads API | ~10 | 1 | Baixa | 5 |
| Meta Ads API | ~10 | 1 | Baixa | 5 |
| **Subtotal AIE** | | | | **10** |

**EEs identificadas:**

| EE | DET | ALR | Complexidade | PF |
|----|-----|-----|-------------|-----|
| Criar contato | 10 | 2 (Contact, ContactTag) | Media | 4 |
| Editar contato | 10 | 2 | Media | 4 |
| Deletar contato | 1 | 1 | Baixa | 3 |
| Criar empresa | 5 | 1 | Baixa | 3 |
| Editar empresa | 5 | 1 | Baixa | 3 |
| Deletar empresa | 1 | 1 | Baixa | 3 |
| Criar deal | 6 | 2 (Deal, Activity auto) | Media | 4 |
| Mover deal (kanban) | 2 | 2 (Deal, Activity auto) | Baixa | 3 |
| Criar atividade | 6 | 1 | Baixa | 3 |
| Criar follow-up | 5 | 1 | Baixa | 3 |
| Marcar follow-up done | 2 | 2 (FollowUp, Activity) | Baixa | 3 |
| Importar CSV | 12 | 3 (Contact, Company, Tag) | Alta | 6 |
| Webhook lead capture | 8 | 3 (Contact, LeadCapture, Tag) | Media | 4 |
| Criar/editar tag | 3 | 1 | Baixa | 3 |
| Criar campanha | 5 | 1 | Baixa | 3 |
| Config pipeline stages | 4 | 1 | Baixa | 3 |
| Reorder stages | 2 | 1 | Baixa | 3 |
| Recalcular scores (batch) | 3 | 2 (Contact, Activity) | Baixa | 3 |
| Login mock | 2 | 1 | Baixa | 3 |
| **Subtotal EE** | | | | **62** |

**SEs identificadas:**

| SE | DET | ALR | Complexidade | PF |
|----|-----|-----|-------------|-----|
| Dashboard ROI (stats + funil + charts) | 15+ | 4+ (Contact, Deal, Campaign, Stage) | Alta | 7 |
| Export CSV contatos | 10 | 2 | Media | 5 |
| Relatorio lead scoring (breakdown) | 8 | 2 (Contact, Activity) | Media | 5 |
| **Subtotal SE** | | | | **17** |

**CEs identificadas:**

| CE | DET | ALR | Complexidade | PF |
|----|-----|-----|-------------|-----|
| Listar contatos (com filtros) | 12 | 3 (Contact, Company, Tag) | Media | 4 |
| Detalhe contato (perfil + timeline) | 15 | 4 (Contact, Activity, Deal, Tag) | Alta | 6 |
| Listar empresas | 6 | 1 | Baixa | 3 |
| Pipeline kanban (deals por stage) | 10 | 3 (Deal, Contact, Stage) | Media | 4 |
| Detalhe deal (slide-over) | 10 | 3 (Deal, Contact, Activity) | Media | 4 |
| Listar atividades | 8 | 2 | Baixa | 3 |
| Listar follow-ups (por urgencia) | 8 | 2 (FollowUp, Contact) | Baixa | 3 |
| Listar campanhas | 6 | 2 (Campaign, LeadCapture) | Baixa | 3 |
| Listar tags | 3 | 1 | Baixa | 3 |
| Config pipeline stages | 5 | 1 | Baixa | 3 |
| Webhook log (ultimas capturas) | 6 | 1 | Baixa | 3 |
| **Subtotal CE** | | | | **39** |

### Total PFNA do CRM

```
ALI:  70
AIE:  10
EE:   62
SE:   17
CE:   39
─────────
PFNA: 198
```

---

## 7. Fator de ajuste (VAF)

O PFNA pode ser ajustado por 14 caracteristicas gerais do sistema (GSC), cada uma pontuada de 0 a 5:

| # | Caracteristica | 0 = nenhuma influencia, 5 = influencia forte |
|---|---------------|----------------------------------------------|
| 1 | Comunicacao de dados | Quantos protocolos de comunicacao? |
| 2 | Processamento distribuido | Dados distribuidos entre componentes? |
| 3 | Performance | Tempo de resposta critico? |
| 4 | Configuracao pesadamente utilizada | Hardware/plataforma limitante? |
| 5 | Taxa de transacao | Volume alto de transacoes? |
| 6 | Entrada de dados on-line | Proporcao de entradas interativas? |
| 7 | Eficiencia do usuario final | UX critica? Navegacao, ajuda, defaults? |
| 8 | Atualizacao on-line | ALIs atualizados em tempo real? |
| 9 | Processamento complexo | Logica de negocio complexa? Calculos? |
| 10 | Reusabilidade | Codigo/componentes reutilizaveis? |
| 11 | Facilidade de instalacao | Setup/deploy automatizado? |
| 12 | Facilidade de operacao | Backup, recovery, monitoramento? |
| 13 | Multiplos locais | Usado em multiplos ambientes? |
| 14 | Facilidade de mudanca | Flexibilidade pra mudancas futuras? |

### Calculo

```
TDI = soma das 14 caracteristicas (0-70)
VAF = 0.65 + (TDI × 0.01)
PFA = PFNA × VAF
```

VAF varia entre 0.65 (TDI=0) e 1.35 (TDI=70).

### Exemplo CRM

| # | Caracteristica | Nota | Justificativa |
|---|---------------|------|---------------|
| 1 | Comunicacao de dados | 3 | API REST, webhooks |
| 2 | Processamento distribuido | 1 | Monolitico com integracoes |
| 3 | Performance | 3 | Dashboard <2s com 10k leads |
| 4 | Config pesadamente utilizada | 0 | Nao aplicavel |
| 5 | Taxa de transacao | 2 | Volume moderado |
| 6 | Entrada on-line | 5 | 100% web interativo |
| 7 | Eficiencia do usuario final | 4 | Mobile-first, kanban, filtros |
| 8 | Atualizacao on-line | 4 | Drag-and-drop, inline edit |
| 9 | Processamento complexo | 3 | Lead scoring, ROI calc |
| 10 | Reusabilidade | 4 | DataTable, KanbanBoard, etc |
| 11 | Facilidade de instalacao | 2 | start.sh, supabase db push |
| 12 | Facilidade de operacao | 1 | Supabase gerenciado, sem infra complexa |
| 13 | Multiplos locais | 1 | 1 ambiente por enquanto |
| 14 | Facilidade de mudanca | 3 | SQL migrations, modular |
| | **TDI** | **36** | |

```
VAF = 0.65 + (36 × 0.01) = 1.01
PFA = 198 × 1.01 = ~200 PF
```

**CRM de Marketing = ~200 Pontos de Funcao ajustados.**

---

## 8. Metricas derivadas de PF

### Produtividade

```
Horas por PF = total de horas / PF
PF por pessoa-mes = PF / (pessoas × meses)
```

**Benchmarks de mercado (ISBSG):**

| Contexto | Horas/PF | PF/pessoa-mes |
|----------|----------|---------------|
| Mercado geral (Brasil) | 10-15 h/PF | 12-18 PF/pm |
| Empresas maduras | 6-10 h/PF | 18-30 PF/pm |
| Com automacao/agentes | 3-6 h/PF | 30-60 PF/pm |

### Custo

```
Custo por PF = custo total do projeto / PF
Custo do projeto = PF × custo por PF
```

**Referencia de mercado (Brasil, 2024-2026):**

| Segmento | R$/PF |
|----------|-------|
| Governo (licitacao) | R$ 600-900 |
| Grandes empresas | R$ 400-700 |
| PMEs / consultorias | R$ 250-500 |
| Startups / agil | R$ 150-350 |

### Estimativa de prazo

```
Prazo (meses) = PF / (equipe × PF/pessoa-mes)
```

Exemplo CRM:
```
200 PF / (3 builders × 25 PF/pm) = 2.7 meses ≈ 4 sprints
```

---

## 9. Contagem estimativa (NESMA simplificada)

Para estimativas rapidas sem contagem detalhada, NESMA define valores medios:

| Tipo | PF fixo (complexidade media) |
|------|------------------------------|
| ALI | 7 |
| AIE | 5 |
| EE | 4 |
| SE | 5 |
| CE | 4 |

**Uso:** conta apenas a quantidade de cada tipo, multiplica pelo peso fixo. Margem de erro ~20-30%, mas leva minutos em vez de horas.

Exemplo rapido:
```
10 ALI × 7 = 70
2 AIE × 5 = 10
18 EE × 4 = 72
3 SE × 5 = 15
11 CE × 4 = 44
              ───
PFNA estimado: 211 (vs 198 na contagem detalhada — erro de 6.5%)
```

---

## 10. Contagem indicativa (mais rapida ainda)

Para estimativas de viabilidade (antes da session):

```
PF indicativo = (ALI × 35) + (AIE × 15)
```

So precisa identificar os grupos de dados. Exemplo:
```
10 ALI × 35 = 350
2 AIE × 15 = 30
               ───
PF indicativo: 380
```

**Margem de erro:** 30-50%. Util apenas pra ballpark ("o projeto e de ~300-400 PF, custa ~R$X-Y").

---

## 11. Regras de contagem — detalhes importantes

### O que conta como 1 ALI?

- Grupo de dados logicamente relacionado, mantido pelo sistema
- Cada **entidade independente** com CRUD = 1 ALI
- Tabelas de associacao (junction) **nao** sao ALI separado — sao RLR do ALI pai
- Exemplo: `Contact` = 1 ALI com 2 RLR (Contact + ContactTag junction)

### O que conta como DET?

- Cada campo reconhecido pelo usuario no form/tela
- Campos calculados contam (score = DET)
- Campos de chave estrangeira **nao** contam como DET (sao relacionamento, nao dado)
- Campos de auditoria (createdAt, updatedAt) **nao** contam
- Botao de acao (salvar, deletar) = 1 DET
- Mensagem de erro/sucesso = 1 DET

### O que conta como 1 EE?

- Cada processo elementar que **altera** um ALI
- Criar + Editar + Deletar de uma entidade = **3 EEs separadas**
- Import CSV que cria contatos = 1 EE (mesmo que crie 1000 registros)
- Drag-and-drop que muda status = 1 EE

### Quando CE vira SE?

- Se a consulta faz **calculo, derivacao ou formatacao** alem de recuperar dados = SE
- "Listar contatos" = CE (mostra dados como estao)
- "Dashboard com CAC, ROI, conversao" = SE (calcula metricas)
- "Export CSV" = SE (formata e processa pra gerar arquivo)

### Transacoes duplicadas

- Mesma funcionalidade em telas diferentes = conta 1 vez
- "Criar contato" via form e via import CSV = 2 EEs (processos diferentes)
- "Ver contatos" na listagem e no detalhe do deal = 1 CE (mesmo dado)

---

## 12. Tipos de contagem

| Tipo | Quando usar | O que conta |
|------|-------------|-------------|
| **Projeto de desenvolvimento** | Sistema novo | Todas as funcoes do sistema |
| **Projeto de melhoria** | Mudancas em sistema existente | Funcoes adicionadas + alteradas + (deletadas × 0.4) |
| **Aplicacao** | Dimensionar sistema existente | Todas as funcoes atuais do sistema |

### Formula de melhoria

```
PF melhoria = PF adicionados + PF alterados + (PF deletados × 0.4)
```

Exemplo: CI Session gera 5 features novas (30 PF) + altera 3 existentes (15 PF) + remove 1 (5 PF):
```
PF melhoria = 30 + 15 + (5 × 0.4) = 47 PF
```

---

## 13. Relacao PF × SP (conversao)

Nao existe conversao universal. A razao depende do time, stack e contexto. Mas pode ser descoberta empiricamente:

```
Razao = PF total do projeto / SP total do projeto
```

Exemplo CRM:
```
200 PF / 198 SP = ~1.01 PF/SP
```

Nesse caso, 1 PF ≈ 1 SP. Mas isso e coincidencia do projeto — em outro contexto pode ser 0.5 ou 2.0.

**O valor da razao:** uma vez estabilizada (3+ projetos), permite converter entre metricas:
- Comercial fala em PF (contrato)
- Time fala em SP (sprint)
- `SP estimados = PF × razao`

---

## 14. Ferramentas e certificacoes

### Certificacoes

| Certificacao | Entidade | O que valida |
|-------------|----------|-------------|
| CFPS | IFPUG | Certified Function Point Specialist |
| CFPP | IFPUG | Certified Function Point Practitioner |

### Normas

| Norma | Escopo |
|-------|--------|
| ISO/IEC 20926 | IFPUG FPA (o padrao) |
| ISO/IEC 24570 | NESMA FPA |
| ISO/IEC 19761 | COSMIC FFP (alternativa pra real-time/embedded) |

### Referencias de mercado

| Fonte | O que oferece |
|-------|-------------|
| ISBSG (International Software Benchmarking Standards Group) | Dados globais de produtividade PF/pm |
| BFPUG (Brazilian Function Point Users Group) | Dados e praticas do mercado brasileiro |
| SISP (Sistema de Administracao dos Recursos de TI do Governo) | Guia de metricas pra contratacao publica no Brasil |
