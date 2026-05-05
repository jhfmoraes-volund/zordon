# Base Referencial — Funções IFPUG rotuladas

> Catálogo vivo de funções IFPUG já medidas oficialmente. Usado como âncora de comparação ao atribuir PF a funcionalidades novas.
>
> **v0** semeada com 3 medições oficiais históricas (Riple, PGF, Escalas Médicas — sistemas administrativos públicos Prodesp). Total: **215 funções rotuladas**, 1.105 PF IFPUG bruto.
>
> **Como usar:** procurar análogo por verbo + tipo IFPUG + entidade. Citar a função-âncora na coluna "Análogo" da tabela de PF do projeto-alvo.

## Índice de tipos IFPUG

- **ALI** — Arquivo Lógico Interno (entidades persistidas)
- **AIE** — Arquivo de Interface Externa (dependências externas)
- **EE** — Entrada Externa (mutações)
- **SE** — Saída Externa (relatórios, exports, dashboards com cálculo)
- **CE** — Consulta Externa (leituras sem agregação)

---

## Riple — Fase 4 / Medição 6

_Ferramenta interna Prodesp pra gestão de OSs (HH→PF), apontamentos, fornecedores_

**Totais:** 17 funções · 105 PF IFPUG · 99.75 PF ajustado

### AIE — Arquivo de Interface Externa (dependências externas) (1 funções, 7 PF)

- `Resolver_Taxa_PF_Dominancia_Estrita` — AIE Média — DET 20, AR 4 — **7 PF**

### EE — Entrada Externa (mutações) (10 funções, 60 PF)

- `Apontamento_Pos_Fechamento_Insercao` — EE Alta — DET 10, AR 4 — **6 PF**
- `Captura_Apontamentos_Orfaos_Fechados` — EE Alta — DET 8, AR 4 — **6 PF**
- `Confirmar_Migracao_Item_HHPF_Para_PF` — EE Alta — DET 10, AR 5 — **6 PF**
- `Conversao_HH_Para_PF_RN02` — EE Alta — DET 12, AR 5 — **6 PF**
- `Conversao_PROVISORIA_Para_PF_Definitiva` — EE Alta — DET 10, AR 5 — **6 PF**
- `OS_Vinculo_Multiplas_ESPs_Combo` — EE Alta — DET 8, AR 4 — **6 PF**
- `Preservacao_Itens_OS_Ao_Trocar_Tipo` — EE Alta — DET 10, AR 4 — **6 PF**
- `Projeto_Vinculo_Multiplas_ESPs` — EE Alta — DET 10, AR 4 — **6 PF**
- `Regra_Assinado_Vence_SEI_Selecao_Doc` — EE Alta — DET 8, AR 4 — **6 PF**
- `Tipo_OS_PROVISORIA_PF` — EE Alta — DET 12, AR 5 — **6 PF**

### SE — Saída Externa (relatórios, exports, dashboards com cálculo) (2 funções, 14 PF)

- `Exportar_Calendario_Excel_Fornecedor` — SE Alta — DET 12, AR 5 — **7 PF**
- `Preview_DryRun_Migracao_Item_HHPF` — SE Alta — DET 12, AR 5 — **7 PF**

### CE — Consulta Externa (leituras sem agregação) (4 funções, 24 PF)

- `Calendario_Apontamentos_Fornecedor` — CE Alta — DET 14, AR 6 — **6 PF**
- `Dashboard_Medicao_Por_Gerencia` — CE Alta — DET 14, AR 5 — **6 PF**
- `Detalhe_OS_Para_Migracao_HHPF` — CE Alta — DET 14, AR 6 — **6 PF**
- `Listar_OSs_Migraveis_HHPF` — CE Alta — DET 12, AR 5 — **6 PF**

---

## PGF — Plataforma de Gestão Financeira

_Plataforma financeira pra cobrança/faturamento (clientes, contratos, pagamentos, integrações DETRAN/Poupatempo)_

**Totais:** 194 funções · 980 PF IFPUG · 232.39 PF ajustado

### Medição: M04-ABR/2026 (114 funções, 602 PF IFPUG)

#### ALI — Arquivo Lógico Interno (entidades persistidas) (16 funções, 112 PF)

- `Alteração ALI perfis — unificação "Cliente" + matriz Helpdesk N1` — ALI Baixa — DET 5, AR 3 — **7 PF** (manut=A, ajustado 5.32)
- `Bilhetagem Portal Credenciados` — ALI Baixa — DET 12, AR 2 — **7 PF**
- `Calendário Credenciados` — ALI Baixa — DET 9, AR 2 — **7 PF**
- `Configurações Integração DB (eCRV)` — ALI Baixa — DET 10, AR 2 — **7 PF**
- `Convites de Usuário` — ALI Baixa — DET 11, AR 3 — **7 PF**
- `Execuções Consolidação Credenciados` — ALI Baixa — DET 16, AR 4 — **7 PF**
- `Histórico Requisições Credenciados` — ALI Baixa — DET 7, AR 2 — **7 PF**
- `Informes Anuais Pagamento (Poupatempo)` — ALI Baixa — DET 12, AR 2 — **7 PF**
- `Notas de Débito (Poupatempo)` — ALI Baixa — DET 14, AR 3 — **7 PF**
- `Pré-Faturamento Itens` — ALI Baixa — DET 18, AR 5 — **7 PF**
- `Tabela assinaturas_govbr` — ALI Baixa — DET 9, AR 2 — **7 PF**
- `assinaturas_govbr` — ALI Baixa — DET 9, AR 2 — **7 PF**
- `faturamento unificada (multi-origem)` — ALI Baixa — DET 18, AR 3 — **7 PF** (manut=A, ajustado 5.32)
- `faturamento unificada + faturamento_itens (multi-origem)` — ALI Baixa — DET 18, AR 3 — **7 PF** (manut=A, ajustado 5.32)
- `faturamento_itens (detalhados)` — ALI Baixa — DET 9, AR 2 — **7 PF**
- `kafka_nf_lotes` — ALI Baixa — DET 7, AR 1 — **7 PF**

#### AIE — Arquivo de Interface Externa (dependências externas) (6 funções, 34 PF)

- `API ERP PRODESP (Sincronização de Clientes)` — AIE Média — DET 25, AR 4 — **7 PF**
- `API Receita Federal (Consulta CNPJ)` — AIE Baixa — DET 15, AR 3 — **5 PF**
- `API Sintegra (Consulta IE Estadual)` — AIE Baixa — DET 12, AR 2 — **5 PF**
- `FEBRABAN 240 (Retorno Bancário)` — AIE Média — DET 20, AR 3 — **7 PF**
- `Portal de Delegados — JSON Externo (Credenciados)` — AIE Baixa — DET 10, AR 2 — **5 PF**
- `ViaCEP (Consulta de Endereço)` — AIE Baixa — DET 8, AR 1 — **5 PF**

#### EE — Entrada Externa (mutações) (57 funções, 288 PF)

- `API B2B - Webhook Credenciados URL JSON` — EE Média — DET 6, AR 2 — **4 PF**
- `Baixa Manual Boleto / Religação / Divergência (3 fluxos)` — EE Média — DET 7, AR 2 — **4 PF**
- `CRUD Calendário Credenciados` — EE Baixa — DET 6, AR 1 — **3 PF**
- `CRUD Configuração Integração DB (eCRV)` — EE Baixa — DET 8, AR 1 — **3 PF**
- `CRUD Gratuidades Cliente (Detran)` — EE Média — DET 12, AR 2 — **4 PF**
- `CRUD Serviços PRODESP (Detran — ServicoForm)` — EE Alta — DET 14, AR 3 — **6 PF**
- `Cancelamento Manual (RPS/NF-e/Religação/Divergência) (4 fluxos)` — EE Média — DET 5, AR 2 — **4 PF**
- `Cancelar Fatura (Estorno)` — EE Alta — DET 5, AR 3 — **6 PF**
- `Confirmar/Aprovar Pré-Faturamento` — EE Média — DET 5, AR 2 — **4 PF**
- `Consolidar Pré-Faturamento Credenciados (Edge Function)` — EE Alta — DET 8, AR 4 — **6 PF**
- `Criar Cliente Detran/Poupatempo/Consignatários (3 edge fns)` — EE Média — DET 10, AR 2 — **4 PF**
- `Criar Cliente Edge Function REST (Detran)` — EE Alta — DET 22, AR 2 — **6 PF**
- `Criar Cliente via Modal (Detran)` — EE Alta — DET 30, AR 3 — **6 PF**
- `Dispatch Jobs (Edge Function)` — EE Média — DET 6, AR 2 — **4 PF**
- `Enviar Convite de Usuário (Edge Function)` — EE Alta — DET 6, AR 3 — **6 PF**
- `Exclusão dos perfis legados "Clientes – Financeiro" e "Suporte"` — EE Média — DET 2, AR 3 — **4 PF** (manut=E, ajustado 1.52)
- `Executar Integrações manualmente (Edge Function)` — EE Média — DET 6, AR 2 — **4 PF**
- `Exportar Dados BI (Edge Function)` — EE Alta — DET 8, AR 3 — **6 PF**
- `Exportar Prefeitura ISS (Lote NF-e)` — EE Média — DET 8, AR 2 — **4 PF**
- `Gerar Contrato PDF (Edge Function)` — EE Alta — DET 8, AR 3 — **6 PF**
- `Gerar Faturas a partir de Pré-Faturamento` — EE Alta — DET 12, AR 4 — **6 PF**
- `Gerar GL Contábil (Faturamento/Recebimento)` — EE Alta — DET 10, AR 3 — **6 PF**
- `Gerar Pré-Faturamento (Faturamento)` — EE Alta — DET 10, AR 4 — **6 PF**
- `Gerar Relatório Assíncrono (Edge Function)` — EE Alta — DET 8, AR 3 — **6 PF**
- `Gerar Relatório de Auditoria (Edge Function)` — EE Média — DET 8, AR 2 — **4 PF**
- `Gerar Relatório de Faturas (Edge Function)` — EE Alta — DET 10, AR 4 — **6 PF**
- `Gerar Remessa Bancária (Exportação)` — EE Alta — DET 12, AR 3 — **6 PF**
- `Gestão de Propostas — Documentos Obrigatórios/Opcionais` — EE Alta — DET 8, AR 3 — **6 PF** (manut=A, ajustado 0.24)
- `Importar Clientes Saneados (CSV)` — EE Alta — DET 12, AR 3 — **6 PF**
- `Importar Retorno NF-e` — EE Média — DET 8, AR 2 — **4 PF**
- `Integrar Bilhetagem eCNH (Edge Function)` — EE Alta — DET 14, AR 3 — **6 PF**
- `Integrar Bilhetagem eCRV (Edge Function)` — EE Alta — DET 10, AR 3 — **6 PF**
- `Notificar Documento Recusado (Edge Function)` — EE Alta — DET 5, AR 3 — **6 PF**
- `Processar Bilhetagem Credenciados (Edge Function)` — EE Alta — DET 10, AR 3 — **6 PF**
- `Receber URL de Bilhetagem Credenciados (Edge Function)` — EE Baixa — DET 4, AR 2 — **3 PF**
- `Responsividade Tags Documentos Exigidos (Alteração UI)` — EE Baixa — DET 4, AR 1 — **3 PF** (manut=A, ajustado 0.12)
- `Sincronizar Cliente com ERP (Edge Function)` — EE Alta — DET 15, AR 3 — **6 PF**
- `Vincular Cliente Existente a Módulo` — EE Média — DET 5, AR 2 — **4 PF**
- `api-v1-contratos (CRUD)` — EE Alta — DET 10, AR 3 — **6 PF**
- `buscar-retorno-erp (polling NF/boleto)` — EE Alta — DET 9, AR 3 — **6 PF**
- `consolidar-faturamento-detran v2` — EE Alta — DET 9, AR 4 — **6 PF**
- `enviar-convite-usuario (token SHA-256)` — EE Média — DET 6, AR 2 — **4 PF**
- `enviar-documentos-erp (assíncrono)` — EE Alta — DET 8, AR 3 — **6 PF**
- `enviar-nf-kafka (proxy REST -> Kafka)` — EE Alta — DET 12, AR 4 — **6 PF**
- `enviar-nf-kafka (proxy REST -> Kafka, lote multi-RPS)` — EE Alta — DET 8, AR 3 — **6 PF**
- `govbr-callback (login OIDC)` — EE Alta — DET 7, AR 3 — **6 PF**
- `govbr-callback (login OIDC)` — EE Alta — DET 7, AR 3 — **6 PF**
- `govbr-callback (troca code -> token, valida nonce/PKCE, persiste assinatura)` — EE Alta — DET 7, AR 3 — **6 PF**
- `govbr-sign-callback (persistência assinatura)` — EE Alta — DET 8, AR 3 — **6 PF**
- `govbr-sign-callback (persistência assinatura)` — EE Alta — DET 8, AR 3 — **6 PF**
- `govbr-sign-init (geração PKCE + redirect IDP.SP)` — EE Média — DET 5, AR 2 — **4 PF**
- `govbr-sign-init (geração PKCE + redirect IDP.SP)` — EE Média — DET 5, AR 2 — **4 PF**
- `integrar-bilhetagem-consignatarios` — EE Média — DET 8, AR 2 — **4 PF**
- `integrar-bilhetagem-ecrv (REST proxy)` — EE Média — DET 10, AR 2 — **4 PF**
- `processar-bilhetagem-credenciados (CSV)` — EE Média — DET 9, AR 2 — **4 PF**
- `sync-cliente-erp (XPRO_WS_IFACE_CLIENTES — payload completo)` — EE Média — DET 12, AR 2 — **4 PF**
- `sync-cliente-erp (XPRO_WS_IFACE_CLIENTES)` — EE Média — DET 14, AR 2 — **4 PF**

#### SE — Saída Externa (relatórios, exports, dashboards com cálculo) (17 funções, 99 PF)

- `API B2B - Dashboard Detran/Poupatempo/Consignatários` — SE Alta — DET 10, AR 4 — **7 PF**
- `Dashboard Executivo` — SE Alta — DET 12, AR 5 — **7 PF**
- `Dashboard Executivo (Gráficos e KPIs)` — SE Alta — DET 22, AR 5 — **7 PF**
- `Extrato Consolidado Detalhado (Consignatários)` — SE Média — DET 12, AR 3 — **5 PF**
- `Extrato Detalhado DETRAN (PDF)` — SE Média — DET 10, AR 3 — **5 PF**
- `Extrato de Operações PDF (Portal Cliente)` — SE Média — DET 8, AR 2 — **5 PF**
- `Extratos em Lote (Exportação)` — SE Média — DET 10, AR 3 — **5 PF**
- `Geração automática DPS/RPS no fechamento` — SE Média — DET 10, AR 2 — **5 PF**
- `Geração automática DPS/RPS no fechamento (numeração + payload fiscal)` — SE Média — DET 10, AR 2 — **5 PF**
- `Geração de Boleto PDF (Cliente Portal)` — SE Média — DET 12, AR 3 — **5 PF**
- `Processamento e Download Bilhetagem Credenciados (Edge Function)` — SE Média — DET 12, AR 3 — **5 PF**
- `Relatório Pré-Fechamento (Detran — cards + tabela)` — SE Alta — DET 18, AR 4 — **7 PF**
- `Relatório de Consolidação Credenciados` — SE Média — DET 15, AR 2 — **5 PF**
- `Relatório de Faturamento Excel` — SE Alta — DET 12, AR 4 — **7 PF**
- `Relatório de Faturas (Faturamento)` — SE Alta — DET 14, AR 4 — **7 PF**
- `Relatórios Gerais DETRAN (7 tipos)` — SE Alta — DET 15, AR 4 — **7 PF**
- `Sincronização de Boletos ERP (Tela + Histórico)` — SE Média — DET 10, AR 3 — **5 PF**

#### CE — Consulta Externa (leituras sem agregação) (18 funções, 69 PF)

- `Consulta Bilhetagem Credenciados (Listagem com Filtros)` — CE Média — DET 10, AR 2 — **4 PF**
- `Consulta Bilhetagem eCNH (Listagem com Filtros)` — CE Média — DET 14, AR 2 — **4 PF**
- `Consulta Bilhetagem eCRV (Listagem com Filtros)` — CE Média — DET 10, AR 2 — **4 PF**
- `Consulta Calendário Credenciados` — CE Baixa — DET 6, AR 1 — **3 PF**
- `Consulta Classe/Tipo de Entidade` — CE Média — DET 10, AR 2 — **4 PF**
- `Consulta Clientes para Vinculação (Modal)` — CE Média — DET 8, AR 2 — **4 PF**
- `Consulta Configuração Integração eCRV` — CE Baixa — DET 8, AR 1 — **3 PF**
- `Consulta Contratos por Módulo (CrudContrato — PPT/Consig/Detran)` — CE Média — DET 12, AR 3 — **4 PF**
- `Consulta Execuções de Consolidação` — CE Baixa — DET 12, AR 1 — **3 PF**
- `Consulta Histórico Sincronização ERP` — CE Média — DET 8, AR 2 — **4 PF**
- `Consulta Inadimplência (Financeiro)` — CE Média — DET 12, AR 3 — **4 PF**
- `Consulta Pendências do Cliente (Portal)` — CE Alta — DET 8, AR 4 — **6 PF**
- `Consulta Receita Federal (Edge Function)` — CE Média — DET 10, AR 2 — **4 PF**
- `Consulta Sintegra (Edge Function)` — CE Média — DET 8, AR 2 — **4 PF**
- `api-v1-clientes (consulta + filtros)` — CE Média — DET 12, AR 3 — **4 PF**
- `api-v1-contratos (consulta escopo)` — CE Média — DET 10, AR 3 — **4 PF**
- `consultar-boleto-bb (2ª via BB)` — CE Baixa — DET 5, AR 1 — **3 PF**
- `consultar-boleto-bb (2ª via Banco do Brasil)` — CE Baixa — DET 5, AR 1 — **3 PF**

### Medição: Medição 02 (M02) (80 funções, 378 PF IFPUG)

#### ALI — Arquivo Lógico Interno (entidades persistidas) (24 funções, 174 PF)

- `Arquivos_Exportacao` — ALI Baixa — DET 10, AR 1 — **7 PF**
- `Arquivos_Importacao` — ALI Baixa — DET 11, AR 1 — **7 PF**
- `Clientes_e_Enderecos` — ALI Baixa — DET 18, AR 2 — **7 PF**
- `Configuracoes_Processamento_Sistemas_Origem` — ALI Baixa — DET 5, AR 1 — **7 PF**
- `Consumos` — ALI Baixa — DET 13, AR 1 — **7 PF**
- `Contratos` — ALI Baixa — DET 12, AR 1 — **7 PF**
- `Gratuidade_Detran` — ALI Baixa — DET 15, AR 4 — **7 PF**
- `Jobs_Agendados` — ALI Baixa — DET 10, AR 1 — **7 PF**
- `Logs_Sistema` — ALI Baixa — DET 7, AR 1 — **7 PF**
- `Modelos_Contrato` — ALI Baixa — DET 9, AR 1 — **7 PF**
- `Municipios_e_Feriados` — ALI Baixa — DET 14, AR 2 — **7 PF**
- `Pagamentos` — ALI Baixa — DET 15, AR 1 — **7 PF**
- `Perfil_Sistemas_Origem` — ALI Baixa — DET 4, AR 2 — **7 PF**
- `Perfis_e_Permissoes` — ALI Baixa — DET 14, AR 3 — **7 PF**
- `Periodos_e_Cobrancas` — ALI Média — DET 22, AR 2 — **10 PF**
- `Pre_Faturamento_Sistemas_Origem` — ALI Baixa — DET 18, AR 2 — **7 PF**
- `Propostas_e_Documentos` — ALI Média — DET 22, AR 2 — **10 PF**
- `RPS_e_NFe` — ALI Baixa — DET 11, AR 1 — **7 PF**
- `Servicos_Especiais_e_Agendamentos` — ALI Baixa — DET 18, AR 2 — **7 PF**
- `Servicos_Faturaveis` — ALI Baixa — DET 12, AR 1 — **7 PF**
- `Sistemas_Origem_e_Docs` — ALI Baixa — DET 10, AR 2 — **7 PF**
- `Taxas_Juros` — ALI Baixa — DET 8, AR 1 — **7 PF**
- `Tipos_Documentos` — ALI Baixa — DET 6, AR 1 — **7 PF**
- `Usuarios_Profiles_Roles` — ALI Baixa — DET 16, AR 3 — **7 PF**

#### EE — Entrada Externa (mutações) (49 funções, 175 PF)

- `Aprovar_Documento` — EE Média — DET 5, AR 2 — **4 PF**
- `Associar_Perfil_Sistemas_Origem` — EE Média — DET 4, AR 3 — **4 PF**
- `Ativar_Inativar_Job` — EE Baixa — DET 3, AR 1 — **3 PF**
- `Atribuir_Perfil_Usuario` — EE Média — DET 4, AR 3 — **4 PF**
- `Atribuir_Permissoes_Perfil` — EE Baixa — DET 4, AR 2 — **3 PF**
- `Atribuir_Roles_Usuario` — EE Baixa — DET 4, AR 2 — **3 PF**
- `Atualizar_Cliente` — EE Média — DET 12, AR 2 — **4 PF**
- `Atualizar_Feriado` — EE Média — DET 5, AR 2 — **4 PF**
- `Atualizar_ModeloContrato` — EE Baixa — DET 8, AR 1 — **3 PF**
- `Atualizar_Municipio` — EE Baixa — DET 5, AR 1 — **3 PF**
- `Atualizar_Perfil` — EE Baixa — DET 6, AR 1 — **3 PF**
- `Atualizar_ServicoEspecial` — EE Baixa — DET 4, AR 1 — **3 PF**
- `Atualizar_ServicoFaturavel` — EE Baixa — DET 10, AR 1 — **3 PF**
- `Atualizar_SistemaOrigem` — EE Baixa — DET 6, AR 1 — **3 PF**
- `Atualizar_Status_Proposta` — EE Baixa — DET 4, AR 2 — **3 PF**
- `Atualizar_TaxaJuros` — EE Baixa — DET 6, AR 1 — **3 PF**
- `Atualizar_TipoDocumento` — EE Baixa — DET 4, AR 1 — **3 PF**
- `Cadastro_Agendamento` — EE Alta — DET 10, AR 3 — **6 PF**
- `Cadastro_Feriado` — EE Média — DET 5, AR 2 — **4 PF**
- `Cadastro_Gratuidade_Detran` — EE Alta — DET 6, AR 3 — **6 PF**
- `Cadastro_ModeloContrato` — EE Baixa — DET 8, AR 1 — **3 PF**
- `Cadastro_Municipio` — EE Baixa — DET 5, AR 1 — **3 PF**
- `Cadastro_Perfil` — EE Baixa — DET 6, AR 1 — **3 PF**
- `Cadastro_PreCliente` — EE Média — DET 10, AR 2 — **4 PF**
- `Cadastro_Proposta` — EE Alta — DET 8, AR 4 — **6 PF**
- `Cadastro_ServicoEspecial` — EE Baixa — DET 4, AR 1 — **3 PF**
- `Cadastro_ServicoFaturavel` — EE Baixa — DET 10, AR 1 — **3 PF**
- `Cadastro_SistemaOrigem` — EE Baixa — DET 6, AR 1 — **3 PF**
- `Cadastro_TaxaJuros` — EE Baixa — DET 6, AR 1 — **3 PF**
- `Cadastro_TipoDocumento` — EE Baixa — DET 4, AR 1 — **3 PF**
- `Cancelar_Agendamento` — EE Baixa — DET 2, AR 1 — **3 PF**
- `Criar_Contrato_de_Proposta` — EE Alta — DET 10, AR 4 — **6 PF**
- `Excluir_Feriado` — EE Baixa — DET 1, AR 1 — **3 PF**
- `Excluir_Perfil` — EE Baixa — DET 1, AR 1 — **3 PF**
- `Importar_Carga_Consumo` — EE Alta — DET 8, AR 4 — **6 PF**
- `Inadimplencia_ConfiguracaoProcessamento_SistemasOrigem` — EE Baixa — DET 3, AR 1 — **3 PF**
- `Inativar_Reativar_Cliente` — EE Baixa — DET 3, AR 1 — **3 PF**
- `Logar_com_GovBR` — EE Média — DET 6, AR 2 — **4 PF**
- `Portal_Cliente_Confirmar_Assinatura` — EE Baixa — DET 3, AR 1 — **3 PF**
- `Portal_Cliente_Dados_Pessoais` — EE Alta — DET 5, AR 3 — **6 PF**
- `Reativar_Contrato` — EE Baixa — DET 3, AR 1 — **3 PF**
- `Recusar_Documento` — EE Média — DET 5, AR 2 — **4 PF**
- `Suspender_Contrato` — EE Baixa — DET 4, AR 1 — **3 PF**
- `Toggle_Status_Municipio` — EE Baixa — DET 2, AR 1 — **3 PF**
- `Toggle_Status_ServicoFaturavel` — EE Baixa — DET 2, AR 1 — **3 PF**
- `Toggle_Status_TaxaJuros` — EE Baixa — DET 2, AR 1 — **3 PF**
- `Toggle_Status_TipoDocumento` — EE Baixa — DET 2, AR 1 — **3 PF**
- `Upload_Documento_Cliente` — EE Média — DET 6, AR 2 — **4 PF**
- `Vincular_DocumentosObrigatorios` — EE Baixa — DET 4, AR 2 — **3 PF**

#### SE — Saída Externa (relatórios, exports, dashboards com cálculo) (1 funções, 4 PF)

- `Suspensão_Integrada_Sistemas_Origem` — SE Baixa — DET 6, AR 1 — **4 PF**

#### CE — Consulta Externa (leituras sem agregação) (6 funções, 25 PF)

- `Download_PDF_Nota` — CE Média — DET 7, AR 3 — **4 PF**
- `Portal_Cliente_Listar_Contratos_Pendente_Assinatura` — CE Baixa — DET 5, AR 2 — **3 PF**
- `Portal_Cliente_Visualizar_Contrato` — CE Alta — DET 8, AR 4 — **6 PF**
- `SSO_GovBR_Sistemas_Origem` — CE Baixa — DET 5, AR 1 — **3 PF**
- `Visualizar_Erros_Job` — CE Baixa — DET 4, AR 1 — **3 PF**
- `Visualizar_Relatórios_Detran` — CE Alta — DET 10, AR 5 — **6 PF**

---

## Escalas Médicas — Fase 2 / Medição 3

_Sistema de escalas médicas (gestão de plantões, agendamento)_

**Totais:** 4 funções · 20 PF IFPUG · 17.29 PF ajustado

### AIE — Arquivo de Interface Externa (dependências externas) (1 funções, 5 PF)

- `2. Política de Segurança em Nível de Linha para Atualização de Perfis pelo Gestor de Unidade` — AIE Baixa — DET 9, AR 5 — **5 PF**

### EE — Entrada Externa (mutações) (2 funções, 12 PF)

- `1. Edição Inline de Dados Pessoais de Médicos pelo Gestor de Unidade` — EE Alta — DET 9, AR 3 — **6 PF**
- `3. Travamento Visual do Campo de Unidade no Assistente de Agendamento quando há Chamamento Ativo` — EE Alta — DET 7, AR 3 — **6 PF** (manut=A, ajustado 4.56)

### CE — Consulta Externa (leituras sem agregação) (1 funções, 3 PF)

- `4. Exibição Consistente de Slots Indisponíveis no Assistente de Agendamento` — CE Baixa — DET 5, AR 2 — **3 PF** (manut=A, ajustado 2.28)

---

## Notas de leitura

- **DET** (Data Element Types) = quantidade de campos únicos referenciados pela função.
- **AR/TR** (Arquivos Referenciados / Tipos de Registro) = quantidade de tabelas/arquivos lógicos tocados.
- **Complexidade** (Baixa/Média/Alta) deriva de DET × AR via [matriz IFPUG](../function-points-reference.md).
- **Manutenção:** I = Inclusão (deflator 1.0), A = Alteração (deflator parcial), E = Exclusão (deflator 0.4). Maioria das entradas é I.
- **PF ajustado** = PF IFPUG × deflator de manutenção × fator disciplina do projeto. Pra lookup de "quanto custa funcionalidade X", use **PF IFPUG bruto**.

## Como expandir

A base é viva. Adicionar uma nova entrada quando:
1. Uma medição oficial nova for incorporada (criar nova seção `## Projeto — Medição N`).
2. Uma função do nicho atual estiver faltando análogo claro pra um caso recorrente.
3. Discrepâncias entre análogos forem identificadas — registrar as duas versões com data + justificativa.
