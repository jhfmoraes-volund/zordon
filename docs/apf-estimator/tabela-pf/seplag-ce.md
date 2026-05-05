# Tabela de PF — SEPLAG-CE

> **Repo:** `github.com/volund-ia/SEPLAG-CE` · commit `f285cd8e`
> **Catálogo de origem:** [../catalogo-funcionalidades/seplag-ce.md](../catalogo-funcionalidades/seplag-ce.md)
> **Base referencial usada:** [../referencial/base-referencial.md](../referencial/base-referencial.md) (215 funções rotuladas de medições oficiais históricas)
> **Matriz IFPUG:** [../../function-points-reference.md](../../function-points-reference.md)
> **Gerada em:** 2026-05-05 · **Marco 2 do** [V3](../../apf-estimator-plan-v3.md) · **Sem código** (lookup textual + matriz IFPUG aplicada por Claude).

---

## Decisões fundadoras (resolvendo os `needs_review` do catálogo)

Todas justificadas com base em IFPUG/SISP + base referencial.

### DEC-01. Auth/Reset (A01-A02): NÃO contam
**Justificativa:** Supabase Auth é infraestrutura. Plano V2 §3.2 explicita: "Auth/social login (Google, GitHub, magic link) → infraestrutura, não AIE". Mesmo princípio se aplica a EE de login. Riple/Escalas Médicas/PGF não contaram login.

### DEC-02. RPCs admin sem call site (admin_atualizar_perfil, admin_set_roles, admin_toggle_usuario_ativo, admin_listar_usuarios, admin_listar_auditoria, orgao_tem_documentos): NÃO contam separado
**Justificativa:** RPCs definidas mas não chamadas pelo front são **sombras** — o front faz a mutation/leitura direta na tabela (verificado por grep). Plano V2 §2.3 (anti-double-count): conta-se na camada mais próxima do banco **que efetivamente é usada**. Se o RPC não é chamado, não há processo elementar adicional. Conta a EE/CE do front.

### DEC-03. Workflow DOE backend (B01-B06): NÃO contam nesta medição
**Justificativa:** RPCs `tramitar_documento`, `publicar_doe`, `solicitar_publicacao`, `devolver_publicacao`, `marcar_tramitacao_lida`, `listar_edicoes_doe` existem no SQL mas não têm UI nem call site. SISP só conta processo elementar **disponível ao usuário**. Sem entry-point de usuário (UI ou API pública), não há função elementar. Quando a UI for construída, viram funções `I` em medição futura.

### DEC-04. `doe-export` (B07): conta como SE
**Justificativa:** edge function com `Content-Type: application/json` e payload pra gateway externo se enquadra em SE (V2 §3.4 — "edge que retorna PDF/CSV/XLSX/JSON pra sistema externo"). Mesmo sendo mock, é função elementar disponível. **SE Alta 7 PF** (DET ~10 do payload, AR 4 — documentos, modelos, orgaos, publicacoes_doe).

### DEC-05. Helpers SQL (`is_admin`, `has_role`, `is_documento_owner`, `log_auditoria`) e RPCs sombra (DEC-02): NÃO contam pra DCFI
**Justificativa:** Guia Local Prodesp DCFI (V2 §3.7) conta **funções SQL com processo elementar próprio**, não helpers de RLS nem triggers de log. Aplicar a regra a todas as 23 RPCs infla artificialmente.
**Critério aplicado:** conta DCFI somente as RPCs **efetivamente chamadas pelo front** (7 RPCs) + as do workflow DOE (6 RPCs definidas mas sem UI ainda) = **13 funções × 1,5 = 19,5 PF**, **capado em 10 PF** (proporcional ao cap de HARDC, evita inflação).

### DEC-06. Numeração técnica (D10 numeracao_doe, D11 numeracao_sequencial): viram RLR, NÃO ALI separadas
**Justificativa:** São tabelas de controle de sequência, não entidades de domínio. Plano V2 §3.1 lista filtros: "Tabela com 0 colunas de domínio → ignorar". Ambas têm essencialmente um nome + valor atual. Tratadas como suporte de D01 (numeracao_sequencial alimenta `documentos.numero`) e D09 (numeracao_doe alimenta `publicacoes_doe`).

### DEC-07. Tramitações (D08): conta como ALI
**Justificativa:** Apesar de parecer log, é entidade de domínio (cada tramitação tem actor, alvo, etapa, timestamp, observações) e tem RPCs próprias (`tramitar_documento`, `marcar_tramitacao_lida`). Conta como ALI Baixa 7 PF.

### DEC-08. `documento_codigos` (D02): RLR de D01, NÃO ALI separada
**Justificativa:** Plano V2 §3.1: tabela complementar com FK + cascade pra `documentos`, sem domínio próprio (só códigos auxiliares). Vira RLR de D01.

### DEC-09. Busca global (A14): SE Alta 7 PF
**Justificativa:** RPC `buscar_documentos` faz JOIN documentos + modelos + orgaos com filtro full-text + agregação de relevance. V2 §3.4: "JOIN de 3+ tabelas com cálculo → SE". Análogo direto: `Consulta Bilhetagem Credenciados (Listagem com Filtros)` (PGF) é CE 6 PF, mas ali é só listagem; aqui há cálculo de relevância → SE.

### DEC-10. Hub admin (A16): SE Alta 7 PF
**Justificativa:** `admin_metricas_hub` agrega contagens de múltiplas tabelas. V2 §3.4: agregação `COUNT/SUM` → SE. Análogo: `Dashboard Executivo (Gráficos e KPIs)` (PGF) SE Alta 7 PF.

### DEC-11. Versionar modelo (A33): EE Alta 6 PF
**Justificativa:** Sem análogo direto na referencial. Aplicar matriz IFPUG: insere em `modelo_versoes` snapshot do estado atual + atualiza `modelos.versao_atual`. DET ~12 (campos copiados pro snapshot) × AR 2 (modelo_versoes + modelos) → Alta. EE Alta 6 PF.

### DEC-12. Visualizar uso do dataset (A37): NÃO conta separado
**Justificativa:** Confirmado pelo código — é apenas seção informativa dentro de A36 (DadoEditarPage), não rota nem tela própria. Mesmo princípio do "filtro = mesma ação" do plano V3.

### DEC-13. PAG (Z01): 3 páginas × 0,6 = 1,8 PF
- /403 Forbidden, /funcionalidades, * NotFound. Sem fetch nem mutation = PAG.

### DEC-14. HARDC (Z03): cap aplicado = 5 PF
**Justificativa:** Status documento (~6 valores) + tipos de bloco (~9) + tipo de documento (~5) = ~20 constantes user-facing × 0,04 = 0,80 PF. Bem abaixo do cap. **Aplicar 0,80 PF**, não 5.

### DEC-15. DATDI (Z04): 1 índice GIN = 4,9 PF
**Justificativa:** Confirmado em migration: `create index idx_modelos_titulo_trgm on public.modelos using gin (titulo gin_trgm_ops)`. V2 §3.7: setup de full-text search → 4,9 PF.

### DEC-16. AIE: 0 funções
**Justificativa:** Sistema não consome APIs externas de domínio. Supabase Auth/Storage = infra (V2 §3.2). Não há `fetch` pra gateway externo (`doe-export` é mock interno = SE).

---

## Tabela de PF (interna — auditoria completa)

### ALI — Arquivos Lógicos Internos

| # | Funcionalidade | Descrição | Tipo | DET | RLR | Complex | PF | Análogo Referencial | Observação |
|---|---|---|---|---|---|---|---|---|---|
| D01 | Documentos | Documentos oficiais com snapshot do corpo, status workflow, número, owner | ALI | 15 | 2 | Baixa | **7** | `Contratos` (PGF) ALI Baixa 7 PF | match direto; `documento_codigos` é RLR (DEC-08) |
| D03 | Modelos | Templates de documento com campos dinâmicos, corpo em blocos, versões | ALI | 12 | 4 | Baixa | **7** | `Modelos_Contrato` (PGF) ALI Baixa 7 PF | match direto |
| D04 | Datasets (listas + itens) | Listas reutilizáveis pra dropdowns dinâmicos | ALI | 8 | 2 | Baixa | **7** | `Tipos_Documentos` (PGF) ALI Baixa 7 PF | match direto |
| D05 | Órgãos | Órgãos públicos com sigla, logo, status | ALI | 8 | 1 | Baixa | **7** | `Clientes_e_Enderecos` (PGF) ALI Baixa 7 PF | match direto |
| D06 | Profiles | Perfil de usuário (estende auth.users) | ALI | 7 | 1 | Baixa | **7** | `Usuarios_Profiles_Roles` (PGF) ALI Baixa 7 PF | match direto |
| D07 | User Roles | Matriz user × role | ALI | 4 | 1 | Baixa | **7** | `Perfis_e_Permissoes` (PGF) ALI Baixa 7 PF | match direto |
| D08 | Tramitações | Histórico de movimentação de documentos | ALI | 8 | 1 | Baixa | **7** | sem direto | matriz IFPUG → ALI Baixa 7 PF (DEC-07) |
| D09 | Publicações DOE | Registro de publicação no Diário Oficial | ALI | 10 | 1 | Baixa | **7** | sem direto | matriz IFPUG → ALI Baixa 7 PF |
| D12 | Auditoria IAM | Log estruturado de eventos IAM | ALI | 9 | 1 | Baixa | **7** | `Logs_Sistema` (PGF) ALI Baixa 7 PF | match direto |
| | **Subtotal ALI** | | | | | | **63** | | 9 ALIs × 7 PF |

> D02 (documento_codigos) = RLR de D01 (DEC-08). D10/D11 (numeração técnica) descartadas (DEC-06).

### AIE — Arquivos de Interface Externa

| # | Funcionalidade | Descrição | Tipo | DET | AR | Complex | PF | Análogo | Observação |
|---|---|---|---|---|---|---|---|---|---|
| | (nenhum) | sistema não consome API externa de domínio | — | — | — | — | **0** | — | DEC-16 |
| | **Subtotal AIE** | | | | | | **0** | | |

### EE — Entradas Externas

| # | Funcionalidade | Descrição | Tipo | DET | AR | Complex | PF | Análogo Referencial | Observação |
|---|---|---|---|---|---|---|---|---|---|
| A07 | Criar documento a partir de modelo | Insert em documentos copiando snapshot do modelo | EE | 8 | 3 | Alta | **6** | `Cadastro_Proposta` (PGF) EE Alta 6 PF | match direto |
| A09 | Excluir documento | Delete cascade de documento + filhos | EE | 2 | 2 | Baixa | **3** | `Excluir_Feriado` (PGF) EE Baixa 3 PF | match direto |
| A11 | Editar corpo do documento | Update do corpo_snapshot (jsonb) com blocos dinâmicos | EE | 10 | 1 | Alta | **6** | `Atualizar_ModeloContrato` (PGF) EE Alta 6 PF | match direto |
| A12 | Upload de imagem no editor | Upload pra Storage + URL pública | EE | 4 | 1 | Baixa | **3** | `Upload_Documento_Cliente` (PGF) EE Alta 6 PF | análogo é Alta porque inclui validação/processamento; aqui é simples upload → EE Baixa 3 PF (matriz IFPUG) |
| A13 | Finalizar documento | RPC altera status, atribui número, dispara workflow | EE | 6 | 3 | Alta | **6** | `Confirmar_Migracao_Item_HHPF_Para_PF` (Riple) EE Alta 6 PF | match direto |
| A18 | Convidar usuário | Edge function: cria user via admin API + profile | EE | 5 | 2 | Alta | **6** | `Enviar Convite de Usuário (Edge Function)` (PGF) EE Alta 6 PF | match direto |
| A19 | Editar perfil de usuário | Update profiles (orgao, nome, status) | EE | 6 | 1 | Alta | **6** | `Atualizar_Cliente` (PGF) EE Alta 6 PF | match direto |
| A20 | Atribuir/remover roles | Insert/delete em user_roles | EE | 3 | 1 | Baixa | **3** | `Atribuir_Roles_Usuario` (PGF) EE Alta 6 PF | análogo é Alta (PGF tem mais campos); aqui só user_id+role → EE Baixa 3 PF (matriz IFPUG) |
| A21 | Ativar/desativar usuário | Update profiles.status | EE | 2 | 1 | Baixa | **3** | `Inativar_Reativar_Cliente` (PGF) EE Alta 6 PF | análogo é Alta (PGF tem RN complexa); aqui é toggle simples → EE Baixa 3 PF |
| A23 | Criar órgão | Insert em orgaos | EE | 6 | 1 | Alta | **6** | `Cadastro_PreCliente` (PGF) EE Alta 6 PF | match direto |
| A24 | Editar órgão | Update orgaos | EE | 6 | 1 | Alta | **6** | `Atualizar_Cliente` (PGF) EE Alta 6 PF | match direto |
| A25 | Excluir órgão | Delete orgaos com validação `orgao_tem_documentos` | EE | 2 | 2 | Baixa | **3** | `Excluir_Feriado` (PGF) EE Baixa 3 PF | match direto |
| A26 | Upload de logo do órgão | Upload pra Storage + grava url no orgao | EE | 3 | 1 | Baixa | **3** | (sem análogo direto) | matriz IFPUG → EE Baixa |
| A28 | Criar modelo | Insert modelos + linhas iniciais em campos/corpo | EE | 8 | 3 | Alta | **6** | `Cadastro_ModeloContrato` (PGF) EE Alta 6 PF | match direto |
| A29 | Excluir modelo | Delete modelos com validação `modelo_tem_documentos` | EE | 2 | 4 | Baixa | **3** | `Excluir_Feriado` (PGF) EE Baixa 3 PF | match direto |
| A30 | Editar modelo — metadados | Update modelos | EE | 8 | 1 | Alta | **6** | `Atualizar_ModeloContrato` (PGF) EE Alta 6 PF | match direto |
| A31 | Editar modelo — corpo (template) | Upsert modelo_corpo (blocos do template) | EE | 10 | 2 | Alta | **6** | `Atualizar_ModeloContrato` (PGF) EE Alta 6 PF | match direto (objeto distinto de A30) |
| A32 | Editar modelo — campos dinâmicos | CRUD em modelo_campos (define campos do template) | EE | 8 | 1 | Alta | **6** | `Vincular_DocumentosObrigatorios` (PGF) EE Alta 6 PF | match direto |
| A33 | Versionar modelo | Insert em modelo_versoes + update versao_atual | EE | 12 | 2 | Alta | **6** | sem direto | matriz IFPUG → EE Alta (DEC-11) |
| A35 | Excluir dataset | Delete dataset_listas + cascade itens | EE | 2 | 2 | Baixa | **3** | `Excluir_Feriado` (PGF) EE Baixa 3 PF | match direto |
| A36 | Editar dataset (lista + itens) | Update lista + CRUD de itens | EE | 8 | 2 | Alta | **6** | `Atualizar_TipoDocumento` (PGF) EE Alta 6 PF | match direto |
| | **Subtotal EE** | | | | | | **102** | | 21 EE |

### SE — Saídas Externas

| # | Funcionalidade | Descrição | Tipo | DET | AR | Complex | PF | Análogo Referencial | Observação |
|---|---|---|---|---|---|---|---|---|---|
| A04 | Dashboard pessoal | Métricas pessoais + globais + últimos 5 documentos | SE | 12 | 5 | Alta | **7** | `Dashboard Executivo (Gráficos e KPIs)` (PGF) SE Alta 7 PF | match direto |
| A14 | Busca global de documentos | Full-text search com agregação relevance + filtros | SE | 10 | 3 | Alta | **7** | sem direto exato | DEC-09 — matriz IFPUG SE Alta |
| A16 | Hub de governança | Métricas administrativas (totais + taxas) | SE | 12 | 5 | Alta | **7** | `Dashboard Executivo (Gráficos e KPIs)` (PGF) SE Alta 7 PF | DEC-10 |
| B07 | Exportar documento pra DOE externo | Edge function gera payload JSON pra gateway externo | SE | 10 | 4 | Alta | **7** | `Gerar Contrato PDF (Edge Function)` (PGF) EE Alta 6 PF | DEC-04 — analogia direta seria EE 6, mas saída pra sistema externo = SE 7 |
| | **Subtotal SE** | | | | | | **28** | | 4 SE |

### CE — Consultas Externas

| # | Funcionalidade | Descrição | Tipo | DET | AR | Complex | PF | Análogo Referencial | Observação |
|---|---|---|---|---|---|---|---|---|---|
| A05 | Listar catálogo de modelos | Lista de modelos com filtro/busca | CE | 8 | 1 | Média | **4** | `Listar_OSs_Migraveis_HHPF` (Riple) CE Alta 6 PF | análogo é Alta (Riple tem mais joins); aqui só modelos → CE Média (matriz IFPUG) |
| A06 | Visualizar detalhe de modelo | Modelo + campos + corpo + contagem de docs | CE | 14 | 4 | Alta | **6** | `Detalhe_OS_Para_Migracao_HHPF` (Riple) CE Alta 6 PF | match direto |
| A08 | Listar meus documentos | Lista paginada com filtro por status | CE | 10 | 2 | Alta | **6** | `Portal_Cliente_Listar_Contratos_Pendente_Assinatur` (PGF) CE Alta 6 PF | match direto |
| A10 | Visualizar documento (read-only) | Doc + corpo + dados de publicação | CE | 14 | 3 | Alta | **6** | `Detalhe_OS_Para_Migracao_HHPF` (Riple) CE Alta 6 PF | match direto |
| A17 | Listar usuários | Lista profiles + orgao | CE | 10 | 2 | Alta | **6** | `Visualizar_Erros_Job` (PGF) CE Alta 6 PF | match direto |
| A22 | Listar órgãos | Lista de órgãos | CE | 8 | 1 | Média | **4** | `Visualizar_Erros_Job` (PGF) CE Alta 6 PF | análogo é Alta (mais joins); aqui só orgaos → CE Média (matriz IFPUG) |
| A27 | Listar modelos (admin) | Lista admin com órgão | CE | 10 | 2 | Alta | **6** | `Listar_OSs_Migraveis_HHPF` (Riple) CE Alta 6 PF | match direto |
| A34 | Listar datasets | Lista de listas + count de itens | CE | 8 | 2 | Média | **4** | `Visualizar_Erros_Job` (PGF) CE Alta 6 PF | análogo é Alta; aqui mais simples → CE Média |
| A38 | Listar log de auditoria | Lista paginada de auditoria_iam + actor | CE | 12 | 2 | Alta | **6** | `Visualizar_Relatórios_Detran` (PGF) CE Alta 6 PF | match direto |
| | **Subtotal CE** | | | | | | **48** | | 9 CE |

### Itens não-mensuráveis (Guia Local Prodesp)

| # | Item | Descrição | Cálculo | PF |
|---|---|---|---|---|
| Z01 | PAG | 3 páginas estáticas (/403, /funcionalidades, /404) | 3 × 0,6 | **1,80** |
| Z02 | DCFI | 13 funções SQL elementares (7 chamadas pelo front + 6 do workflow DOE definidas), capado em 10 PF | min(13×1,5; 10) | **10,00** |
| Z03 | HARDC | ~20 constantes user-facing (status docs, tipos bloco, tipo documento) | 20 × 0,04 | **0,80** |
| Z04 | DATDI | 1 índice GIN trigram em modelos.titulo (full-text search) | 1 × 4,9 | **4,90** |
| | **Subtotal não-mensuráveis** | | | **17,50** |

---

## Total

| Categoria | Itens | PF |
|---|---|---|
| ALI | 9 | 63 |
| AIE | 0 | 0 |
| EE | 21 | 102 |
| SE | 4 | 28 |
| CE | 9 | 48 |
| **Subtotal IFPUG** | **43** | **241** |
| Não-mensuráveis (PAG/DCFI/HARDC/DATDI) | — | 17,50 |
| **TOTAL GERAL** | | **258,50 PF** |

### Sanity check
- Faixa esperada do plano V2 §8.1 (SEPLAG-CE): **150-300 PF** ✅
- Caímos em **258,50 PF** — dentro da faixa, ligeiramente acima da mediana.
- Distribuição EE > CE > ALI > SE = consistente com sistema CRUD-pesado de gestão documental.

### Composição em PF ajustado (manutenção `I` em 100%, deflator 1.0)

Como toda a medição é Inclusão (`I`), PF IFPUG = PF ajustado pré-disciplina.

**Fator disciplina detectado** (V2 §7):
- Implementação: ✅ (sempre)
- Análise/projeto: ⚠️ parcial (não há `docs/adr/`)
- Requisitos: ❌
- Testes: ✅ (`vitest.config.ts` + pasta `src/test`)
- Homologação: ⚠️ (sem branches `staging`/`release` visíveis)
- Documentação: ⚠️ (só `README.md` + `replit.md`)
- Implantação: ❌ (sem `.github/workflows`)

**Pesos detectados:** 0,40 (impl) + 0,15 (testes) + 0,075 (análise parcial) + 0,05 (doc parcial) = **0,675**

**Total ajustado por disciplina:** 258,50 × 0,675 = **174,49 PF ajustado**

> Para precificação interna, a referência principal é o **PF IFPUG (258,50)**. O fator disciplina é uma correção SISP que reflete a maturidade dos artefatos do projeto — útil pra comparar entre projetos, não pra custear individualmente.

---

## Tabela de PF (planilha — formato simplificado)

A planilha .xlsx (gerada em [seplag-ce.xlsx](./seplag-ce.xlsx)) tem as colunas reduzidas:

`# | Funcionalidade | Descrição | Tipo IFPUG | PF | Análogo | Observação`

Total na última linha = soma da coluna PF.
