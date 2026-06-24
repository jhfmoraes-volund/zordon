# Catálogo de Funcionalidades — SEPLAG-CE

> **Repo:** `github.com/volund-ia/SEPLAG-CE` · commit `f285cd8e` · clone shallow em `/tmp/seplag-ce`
> **Stack:** Vite + React + TS + Supabase · file-system routing em `src/pages/` (react-router)
> **Domínio:** Sistema de gestão de documentos oficiais (Diário Oficial Eletrônico — DOE) — modelos, edição, finalização, tramitação, publicação e rastreabilidade.
>
> **Status:** v0 (Claude gera, João revisa). Marco 1 do [V3](../../features/estimation/apf-estimator-plan-v3.md).

## Visão geral do sistema

- **15 rotas privadas** em `src/App.tsx` (RequireAuth + AppLayout) + 4 públicas (auth/reset-password/forbidden/notfound).
- **16 tabelas** relevantes: `documentos`, `documento_codigos`, `modelos`, `modelo_campos`, `modelo_corpo`, `modelo_versoes`, `dataset_listas`, `dataset_itens`, `orgaos`, `profiles`, `user_roles`, `tramitacoes`, `publicacoes_doe`, `numeracao_doe`, `numeracao_sequencial`, `auditoria_iam`.
- **23 funções SQL** definidas em migrations; **7 são chamadas pelo front**, **16 são backend-only** (workflow de tramitação/publicação, helpers admin, log de auditoria).
- **2 edge functions:** `admin-invite` (convidar usuário via Supabase Admin API) e `doe-export` (mock de exportação de documento finalizado pra gateway externo do DOE).
- **2 storage buckets:** `editor-uploads` (imagens no editor de documentos), `logos-orgaos` (logos dos órgãos no admin).
- **Auth:** Supabase Auth (e-mail/senha + reset). Roles via `user_roles` + helpers `is_admin`/`has_role`.

## Anatomia das funcionalidades

Cada funcionalidade abaixo segue o template:

```
### A##. Nome legível
**Tipo provável:** CE | SE | EE | AIE | ALI
**Rotas:** caminho ou (backend-only)
**Tabelas envolvidas:** ...
**Disparo:** o que o usuário faz
**Descrição:** o que acontece
**Sinais técnicos:** queries, RPCs, mutations
**Análogo provável (referencial):** função-âncora da base referencial
**needs_review:** true | false
```

Numeração: A## = funcionalidades de aplicação (CE/SE/EE), D## = ALIs (entidades persistidas), X## = AIEs (interfaces externas).

---

## Entidades persistidas (ALI)

> Cada ALI conta uma vez. Tabelas auth/storage do Supabase **não** entram (infraestrutura).
> Junction tables puras (só FKs) viram RLR da tabela "dona", não ALI separada.

### D01. Documentos
**Tipo:** ALI · **Tabelas:** `documentos` · **DET:** ~15 (id, numero, titulo, status, modelo_id, orgao_id, owner_id, corpo_snapshot, finalizado_em, criado_em, atualizado_em, etc) · **RLR:** 2 (documentos + documento_codigos) · **Análogo:** `Contratos` (PGF) ALI Baixa 7 PF · **needs_review:** false

### D02. Documento — Códigos auxiliares
**Tipo:** ALI · **Tabelas:** `documento_codigos` · Tabela complementar de `documentos` com cascade. **Tratada como RLR de D01**, não conta separado. · **needs_review:** false

### D03. Modelos
**Tipo:** ALI · **Tabelas:** `modelos`, `modelo_campos`, `modelo_corpo`, `modelo_versoes` · **DET:** ~12 (codigo, titulo, tipo_documento, descricao, status, orgao_id, versao_atual, etc + relações filhas) · **RLR:** 4 (a tabela + 3 filhas com cascade) · **Análogo:** `Modelos_Contrato` (PGF) ALI Baixa 7 PF · **needs_review:** false

### D04. Datasets (listas + itens)
**Tipo:** ALI · **Tabelas:** `dataset_listas`, `dataset_itens` · Listas reutilizáveis usadas como source de dropdowns dinâmicos no editor. **DET:** ~8 · **RLR:** 2 · **Análogo:** sem direto na referencial — assemelha-se a `Tipos_Documentos` (PGF) ALI Baixa 7 PF · **needs_review:** false

### D05. Órgãos
**Tipo:** ALI · **Tabelas:** `orgaos` · **DET:** ~8 (sigla, nome, logo_url, status, etc) · **RLR:** 1 · **Análogo:** `Clientes_e_Enderecos` (PGF) ALI Baixa 7 PF · **needs_review:** false

### D06. Profiles (perfil do usuário)
**Tipo:** ALI · **Tabelas:** `profiles` · estende `auth.users` com nome, orgao_id, status, etc. **DET:** ~7 · **RLR:** 1 · **Análogo:** `Usuarios_Profiles_Roles` (PGF) ALI Baixa 7 PF · **needs_review:** false

### D07. User Roles
**Tipo:** ALI · **Tabelas:** `user_roles` · matriz user × role. **DET:** ~4 · **RLR:** 1 · **Análogo:** `Perfis_e_Permissoes` (PGF) ALI Baixa 7 PF · **needs_review:** false

### D08. Tramitações
**Tipo:** ALI · **Tabelas:** `tramitacoes` · histórico de movimentação de documentos entre etapas. **DET:** ~8 · **RLR:** 1 · **Análogo:** sem direto — semelhante ao histórico do `Sincronização de Boletos ERP (Tela + Histórico)` (PGF) · **needs_review:** true (verificar se trabalha como ALI ou só como log)

### D09. Publicações DOE
**Tipo:** ALI · **Tabelas:** `publicacoes_doe` · registro de publicação no Diário Oficial. **DET:** ~10 (edicao_data, secao, numero_materia, pagina, etc) · **RLR:** 1 · **Análogo:** sem direto · **needs_review:** false

### D10. Numeração DOE
**Tipo:** ALI · **Tabelas:** `numeracao_doe` · sequencial controlado de números do DOE. **DET:** ~4 · **RLR:** 1 · **Análogo:** sem direto — controle de sequência. Pode ser tratado como tabela técnica e não contar. · **needs_review:** true

### D11. Numeração Sequencial
**Tipo:** ALI · **Tabelas:** `numeracao_sequencial` · sequencial genérico (provavelmente por modelo/órgão). **DET:** ~4 · **RLR:** 1 · **Análogo:** sem direto · **needs_review:** true (pode ser interno → não conta)

### D12. Auditoria IAM
**Tipo:** ALI · **Tabelas:** `auditoria_iam` · log de eventos de IAM (mudança de role, ativação, etc). **DET:** ~9 (actor, target, action, payload jsonb, criado_em, etc) · **RLR:** 1 · **Análogo:** `Logs_Sistema` (PGF) ALI Baixa 7 PF · **needs_review:** false

---

## Auth (público — `/auth`, `/reset-password`)

### A01. Login (e-mail + senha)
**Tipo:** EE · **Rotas:** `/auth` ([Auth.tsx:1-381](/tmp/seplag-ce/src/pages/Auth.tsx)) · **Tabelas:** `auth.users` (Supabase Auth) + `profiles` (leitura pra orgao) · **Disparo:** form de login. **Descrição:** autentica via Supabase Auth, busca profile, redireciona conforme role. **Sinais:** `supabase.auth.signInWithPassword`, `from('profiles').select(...)`. **Análogo:** `Logar_com_GovBR` (PGF) EE — embora aqui sem GovBR, é mesmo padrão de auth → tratar como **infraestrutura, NÃO conta como EE IFPUG**. · **needs_review:** false

### A02. Reset de senha
**Tipo:** EE · **Rotas:** `/reset-password` ([ResetPassword.tsx](/tmp/seplag-ce/src/pages/ResetPassword.tsx)) · **Tabelas:** `auth.users` · **Disparo:** link de reset por e-mail. **Descrição:** Supabase Auth recovery flow. **Análogo:** infraestrutura — **NÃO conta**. · **needs_review:** false

### A03. Forbidden / NotFound
**Tipo:** PAG (página estática) · **Rotas:** `/403`, `*` · **Tabelas:** — · **Análogo:** página estática Prodesp → 0,6 PF cada (regra V2 §3.7). · **needs_review:** false

---

## Início — `/` (Inicio.tsx)

### A04. Dashboard pessoal (métricas + últimos documentos)
**Tipo:** SE · **Rotas:** `/` ([Inicio.tsx:1-283](/tmp/seplag-ce/src/pages/Inicio.tsx)) · **Tabelas:** `documentos` (leitura) + RPCs de métricas · **Disparo:** entra na home. **Descrição:** mostra saudação, métricas pessoais (`metricas_pessoais`), métricas globais (`metricas_globais`, se admin), últimos 5 documentos do usuário. **Sinais:** `rpc('metricas_dashboard')`, `rpc('metricas_pessoais')`, `rpc('metricas_globais')`, `from('documentos').select('id, titulo, status, updated_at, modelo:modelos(titulo)')`. **Análogo:** `Dashboard Executivo (Gráficos e KPIs)` (PGF) SE Alta 7 PF · **needs_review:** false

---

## Catálogo de modelos — `/catalogo`

### A05. Listar catálogo de modelos
**Tipo:** CE · **Rotas:** `/catalogo` ([Catalogo.tsx:1-427](/tmp/seplag-ce/src/pages/Catalogo.tsx)) · **Tabelas:** `modelos` · **Disparo:** entra no catálogo. **Descrição:** lista todos os modelos disponíveis com busca/filtro por tipo de documento. **Sinais:** `from('modelos').select(...)`. **Análogo:** `Listar_OSs_Migraveis_HHPF` (Riple) CE Alta 6 PF · **needs_review:** false

### A06. Visualizar detalhe de modelo
**Tipo:** CE · **Rotas:** `/catalogo/:id` ([ModeloDetalhe.tsx:1-257](/tmp/seplag-ce/src/pages/ModeloDetalhe.tsx)) · **Tabelas:** `modelos`, `modelo_campos`, `modelo_corpo`, `documentos` (pra contagem) · **Disparo:** clica num modelo. **Descrição:** preview do modelo (corpo + campos), botão "Criar documento". **Análogo:** `Detalhe_OS_Para_Migracao_HHPF` (Riple) CE Alta 6 PF · **needs_review:** false

### A07. Criar documento a partir de modelo
**Tipo:** EE · **Rotas:** `/catalogo/:id` (botão "Criar documento") → redireciona pra `/documentos/:id/editar` · **Tabelas:** `documentos` (insert), copia `modelo_corpo` no snapshot. **Disparo:** clica "Criar documento". **Descrição:** cria registro de documento vinculado ao modelo, gera número, abre editor. **Sinais:** `from('documentos').insert(...)` no `ModeloDetalhe.tsx`. **Análogo:** `Cadastro_Proposta` (PGF) EE Alta 6 PF · **needs_review:** false

---

## Meus Documentos — `/documentos`

### A08. Listar meus documentos
**Tipo:** CE · **Rotas:** `/documentos` ([MeusDocumentos.tsx:1-248](/tmp/seplag-ce/src/pages/MeusDocumentos.tsx)) · **Tabelas:** `documentos` (filtro por owner ou orgão) · **Disparo:** entra. **Descrição:** lista paginada com filtro por status (PENDENTE/FINALIZADO/PUBLICADO/etc). **Análogo:** `Portal_Cliente_Listar_Contratos_Pendente_Assinatur` (PGF) CE Alta 6 PF · **needs_review:** false

### A09. Excluir documento
**Tipo:** EE · **Rotas:** `/documentos` (ação de linha) · **Tabelas:** `documentos` (delete cascade pra documento_codigos, tramitacoes) · **Disparo:** botão excluir. **Descrição:** remove documento que ainda não foi finalizado. **Sinais:** `from('documentos').delete().eq('id', ...)`. **Análogo:** `Excluir_Feriado` (PGF) EE Baixa 3 PF · **needs_review:** false

### A10. Visualizar documento (read-only)
**Tipo:** CE · **Rotas:** `/documentos/:id` ([DocumentoView.tsx:1-313](/tmp/seplag-ce/src/pages/DocumentoView.tsx)) · **Tabelas:** `documentos`, `modelo_corpo` · **Disparo:** clica num documento. **Descrição:** visualização finalizada do documento com snapshot do corpo + dados de publicação se houver. **Análogo:** `Detalhe_OS_Para_Migracao_HHPF` (Riple) CE Alta 6 PF · **needs_review:** false

---

## Editor de Documento — `/documentos/:id/editar` (DocumentoEditor.tsx — 857 linhas)

### A11. Editar corpo do documento (CRUD blocos dinâmicos)
**Tipo:** EE · **Rotas:** `/documentos/:id/editar` · **Tabelas:** `documentos` (update do `corpo_snapshot` jsonb), `modelo_campos`, `modelo_corpo` (leitura) · **Disparo:** edição inline de blocos (título, parágrafo, tabela, divisor, imagem, texto, número, data) e save. **Descrição:** editor estruturado por blocos. Salva snapshot completo do corpo a cada save. **Sinais:** `from('documentos').update({ corpo_snapshot, ... })`. **Análogo:** `Atualizar_ModeloContrato` (PGF) EE Alta 6 PF · **needs_review:** false

### A12. Upload de imagem no editor
**Tipo:** EE · **Rotas:** `/documentos/:id/editar` (componente `DynamicField`) · **Tabelas:** Storage bucket `editor-uploads` · **Disparo:** clica em "imagem" e seleciona arquivo. **Descrição:** upload pra bucket Storage, retorna URL pública. **Análogo:** `Upload_Documento_Cliente` (PGF) EE Alta 6 PF · **needs_review:** false

### A13. Finalizar documento
**Tipo:** EE · **Rotas:** `/documentos/:id/editar` (botão "Finalizar") · **Tabelas:** `documentos` (status, finalizado_em, numero), `numeracao_sequencial` (incrementa) · **Disparo:** clica "Finalizar" + confirma modal. **Descrição:** RPC `finalizar_documento` muda status PENDENTE→FINALIZADO, atribui número sequencial, dispara workflow. **Sinais:** `rpc('finalizar_documento', { _documento_id })`. **Análogo:** `Confirmar_Migracao_Item_HHPF_Para_PF` (Riple) EE Alta 6 PF · **needs_review:** false

---

## Rastreabilidade — `/rastreabilidade`

### A14. Busca global de documentos
**Tipo:** SE · **Rotas:** `/rastreabilidade` ([Rastreabilidade.tsx:1-240](/tmp/seplag-ce/src/pages/Rastreabilidade.tsx)) · **Tabelas:** `documentos` + `modelos` + `orgaos` (joins) · **Disparo:** digita query (debounced) + filtros (modelo, órgão). **Descrição:** busca textual full-text via RPC `buscar_documentos`, retorna lista com matches. **Sinais:** `rpc('buscar_documentos', { _q, _limit })`. Tem agregação de resultados/filtros, justifica SE. **Análogo:** `Consulta Bilhetagem Credenciados (Listagem com Fil...)` (PGF) CE Alta 6 PF — porém aqui tem agregação textual, mais próximo de SE. **PF tentativa:** SE Alta 7 PF. · **needs_review:** true (CE 6 vs SE 7)

---

## Funcionalidades — `/funcionalidades` (informativo)

### A15. Página de funcionalidades (institucional)
**Tipo:** PAG · **Rotas:** `/funcionalidades` ([Funcionalidades.tsx](/tmp/seplag-ce/src/pages/Funcionalidades.tsx)) · **Tabelas:** — · **Descrição:** página estática descrevendo funcionalidades do sistema. Sem queries. · **PF:** 0,6 (PAG, V2 §3.7). · **needs_review:** false

---

## Admin — Hub `/admin`

### A16. Hub de governança (métricas administrativas)
**Tipo:** SE · **Rotas:** `/admin` ([Hub.tsx:1-102](/tmp/seplag-ce/src/pages/admin/Hub.tsx)) · **Tabelas:** múltiplas via RPC · **Disparo:** entra na área admin. **Descrição:** dashboard admin com totais de documentos, usuários, órgãos, modelos, taxa de publicação. **Sinais:** `rpc('admin_metricas_hub')`. **Análogo:** `Dashboard_Medicao_Por_Gerencia` (Riple) CE Alta 6 PF, mas com agregação → SE Alta 7 PF. · **needs_review:** true

---

## Admin — Usuários `/admin/usuarios`

### A17. Listar usuários
**Tipo:** CE · **Rotas:** `/admin/usuarios` ([Usuarios.tsx:1-359](/tmp/seplag-ce/src/pages/admin/Usuarios.tsx)) · **Tabelas:** `profiles`, `orgaos` (join) · **Análogo:** existe RPC `admin_listar_usuarios` no backend mas o front lê direto da `profiles` com select. **PF:** CE Alta 6 PF. · **needs_review:** false

### A18. Convidar novo usuário
**Tipo:** EE · **Rotas:** `/admin/usuarios` (botão "Convidar") · **Edge function:** `admin-invite` · **Tabelas:** `auth.users` (admin API), `profiles` (insert via trigger) · **Disparo:** preenche e-mail/nome/órgão e envia. **Descrição:** edge function gera senha temporária, cria user via Supabase Admin API, cria profile vinculado. **Análogo:** `Enviar Convite de Usuário (Edge Function)` (PGF) EE Alta 6 PF · **needs_review:** false

### A19. Editar perfil de usuário (orgão, nome, status)
**Tipo:** EE · **Rotas:** `/admin/usuarios` (modal de edição) · **Tabelas:** `profiles` (update) · **Sinais:** `from('profiles').update(...)`. RPC `admin_atualizar_perfil` existe no backend mas não é chamada pelo front (front faz update direto). **Análogo:** `Atualizar_Cliente` (PGF) EE Alta 6 PF · **needs_review:** false

### A20. Atribuir/remover roles do usuário
**Tipo:** EE · **Rotas:** `/admin/usuarios` (modal de roles) · **Tabelas:** `user_roles` (insert/delete). **Sinais:** RPC `admin_set_roles` existe no backend; front pode usar ou fazer mutations diretas — **needs_review pra confirmar qual caminho usado**. **Análogo:** `Atribuir_Roles_Usuario` (PGF) EE Alta 6 PF · **needs_review:** true

### A21. Ativar/desativar usuário
**Tipo:** EE · **Rotas:** `/admin/usuarios` · **Tabelas:** `profiles` (update status) · **Sinais:** RPC `admin_toggle_usuario_ativo` no backend. **Análogo:** `Inativar_Reativar_Cliente` (PGF) EE Alta 6 PF · **needs_review:** false

---

## Admin — Órgãos `/admin/orgaos`

### A22. Listar órgãos
**Tipo:** CE · **Rotas:** `/admin/orgaos` ([Orgaos.tsx:1-549](/tmp/seplag-ce/src/pages/admin/Orgaos.tsx)) · **Tabelas:** `orgaos` · **Análogo:** `Visualizar_Erros_Job` (PGF) CE Alta 6 PF · **needs_review:** false

### A23. Criar órgão
**Tipo:** EE · **Rotas:** `/admin/orgaos` (botão "Novo") · **Tabelas:** `orgaos` (insert) · **Análogo:** `Cadastro_PreCliente` (PGF) EE Alta 6 PF · **needs_review:** false

### A24. Editar órgão
**Tipo:** EE · **Rotas:** `/admin/orgaos` (modal) · **Tabelas:** `orgaos` (update) · **Análogo:** `Atualizar_Cliente` (PGF) EE Alta 6 PF · **needs_review:** false

### A25. Excluir órgão
**Tipo:** EE · **Rotas:** `/admin/orgaos` · **Tabelas:** `orgaos` (delete) — RPC backend `orgao_tem_documentos` valida antes. **Análogo:** `Excluir_Feriado` (PGF) EE Baixa 3 PF · **needs_review:** false

### A26. Upload de logo do órgão
**Tipo:** EE · **Rotas:** `/admin/orgaos` (componente de upload) · **Storage:** `logos-orgaos` · **Análogo:** `Upload_Documento_Cliente` (PGF) EE Alta 6 PF · **needs_review:** false

---

## Admin — Modelos `/admin/modelos`

### A27. Listar modelos (admin)
**Tipo:** CE · **Rotas:** `/admin/modelos` ([Modelos.tsx:1-1068](/tmp/seplag-ce/src/pages/admin/Modelos.tsx)) · **Tabelas:** `modelos` + `orgaos` (join) · **Análogo:** `Catalogo_Modelos` (parecido com `Listar_OSs_Migraveis_HHPF`) CE Alta 6 PF · **needs_review:** false

### A28. Criar modelo
**Tipo:** EE · **Rotas:** `/admin/modelos` · **Tabelas:** `modelos` (insert), `modelo_campos`, `modelo_corpo` (cascade de criação inicial) · **Análogo:** `Cadastro_ModeloContrato` (PGF) EE Alta 6 PF · **needs_review:** false

### A29. Excluir modelo (com validação)
**Tipo:** EE · **Rotas:** `/admin/modelos` · **Tabelas:** `modelos` (delete), `modelo_campos`, `modelo_corpo` (cascade). RPC `modelo_tem_documentos` valida antes. **Análogo:** `Excluir_Feriado` (PGF) EE Baixa 3 PF · **needs_review:** false

### A30. Editar modelo — metadados
**Tipo:** EE · **Rotas:** `/admin/modelos/:id/editar` ([ModeloEditarPage.tsx:1-1236](/tmp/seplag-ce/src/pages/admin/ModeloEditarPage.tsx)) · **Tabelas:** `modelos` (update) · **Análogo:** `Atualizar_ModeloContrato` (PGF) EE Alta 6 PF · **needs_review:** false

### A31. Editar modelo — corpo (blocos do template)
**Tipo:** EE · **Rotas:** `/admin/modelos/:id/editar` · **Tabelas:** `modelo_corpo` (upsert), `dataset_listas` (referenciada) · **Disparo:** edita blocos do corpo do template (mesmo editor de A11, mas pro template). **Análogo:** `Atualizar_ModeloContrato` (PGF) EE Alta 6 PF — **MAS é função distinta de A30 (objeto diferente, corpo vs metadados)**. · **needs_review:** false

### A32. Editar modelo — campos dinâmicos
**Tipo:** EE · **Rotas:** `/admin/modelos/:id/editar` · **Tabelas:** `modelo_campos` (insert/update/delete) · **Disparo:** define quais campos o usuário preenche ao instanciar o modelo. **Análogo:** `Vincular_DocumentosObrigatorios` (PGF) EE Alta 6 PF · **needs_review:** false

### A33. Versionar modelo (criar nova versão)
**Tipo:** EE · **Rotas:** `/admin/modelos/:id/editar` · **Tabelas:** `modelo_versoes` (insert) + `modelos` (update versao_atual) · **Análogo:** sem direto na referencial; padrão de "snapshot/versão" → tratar como EE Alta 6 PF (matriz IFPUG). · **needs_review:** true

---

## Admin — Dados (datasets) `/admin/dados`

### A34. Listar datasets
**Tipo:** CE · **Rotas:** `/admin/dados` ([Dados.tsx:1-372](/tmp/seplag-ce/src/pages/admin/Dados.tsx)) · **Tabelas:** `dataset_listas`, `dataset_itens` (count) · **Análogo:** `Visualizar_Erros_Job` (PGF) CE Alta 6 PF · **needs_review:** false

### A35. Excluir dataset
**Tipo:** EE · **Rotas:** `/admin/dados` · **Tabelas:** `dataset_listas` (delete), `dataset_itens` (cascade) · **Análogo:** `Excluir_Feriado` (PGF) EE Baixa 3 PF · **needs_review:** false

### A36. Editar dataset (lista + itens)
**Tipo:** EE · **Rotas:** `/admin/dados/:id/editar` ([DadoEditarPage.tsx:1-1291](/tmp/seplag-ce/src/pages/admin/DadoEditarPage.tsx)) · **Tabelas:** `dataset_listas` (update), `dataset_itens` (CRUD) · **Disparo:** editor da lista + tabela de itens (insert/update/delete). **Análogo:** `Atualizar_TipoDocumento` (PGF) EE Alta 6 PF · **needs_review:** false

### A37. Visualizar uso do dataset (qual modelo/documento referencia)
**Tipo:** CE · **Rotas:** `/admin/dados/:id/editar` (aba/seção de uso) · **Tabelas:** `modelos`, `modelo_campos`, `documentos` (joins de uso) · **Análogo:** `Visualizar_Erros_Job` (PGF) CE Alta 6 PF · **needs_review:** true (verificar se é tela própria ou só info no editor)

---

## Admin — Auditoria `/admin/auditoria`

### A38. Listar log de auditoria IAM
**Tipo:** CE · **Rotas:** `/admin/auditoria` ([Auditoria.tsx:1-289](/tmp/seplag-ce/src/pages/admin/Auditoria.tsx)) · **Tabelas:** `auditoria_iam` + `profiles` (join). RPC `admin_listar_auditoria` existe no backend; front lê direto da view. **Análogo:** `Logs_Sistema` (PGF) ALI — mas pra **listar** seria CE. **PF tentativa:** CE Alta 6 PF. · **needs_review:** false

---

## Backend-only — funções SQL não expostas no front

> Essas RPCs estão definidas em migrations mas **não há call site em `src/`**. Decidir no Marco 2 se contam ou não:
> - Se forem **chamadas indiretamente por workflow/triggers** → contam como EE/SE.
> - Se forem **dead code** ou puramente helpers internos → não contam.
> - Atualmente **TODAS marcadas needs_review:true** pra revisão João.

### B01. Tramitar documento (RPC `tramitar_documento`)
**Tipo:** EE provável · **Tabelas:** `documentos` (update status), `tramitacoes` (insert) · **Hipótese:** workflow de tramitação entre etapas. Não há botão no front que dispare hoje. **Análogo:** `Atualizar_Status_Proposta` (PGF) EE Alta 6 PF · **needs_review:** true

### B02. Solicitar publicação DOE (RPC `solicitar_publicacao`)
**Tipo:** EE provável · **Tabelas:** `documentos`, `publicacoes_doe` (insert) · **needs_review:** true

### B03. Devolver publicação (RPC `devolver_publicacao`)
**Tipo:** EE provável · **Tabelas:** `publicacoes_doe`, `documentos` · **needs_review:** true

### B04. Publicar no DOE (RPC `publicar_doe`)
**Tipo:** EE provável · **Tabelas:** `publicacoes_doe` (update), `numeracao_doe` (incrementa), `documentos` (status PUBLICADO) · **Análogo:** `Confirmar_Migracao_Item_HHPF_Para_PF` (Riple) EE Alta 6 PF · **needs_review:** true

### B05. Listar edições do DOE (RPC `listar_edicoes_doe`)
**Tipo:** CE provável · **Tabelas:** `publicacoes_doe`, `numeracao_doe` · **needs_review:** true

### B06. Marcar tramitação como lida (RPC `marcar_tramitacao_lida`)
**Tipo:** EE provável · **Tabelas:** `tramitacoes` · **needs_review:** true

### B07. Exportar documento pra DOE externo (edge `doe-export`)
**Tipo:** SE · **Edge function:** `doe-export` · **Tabelas:** `documentos`, `modelos`, `orgaos`, `publicacoes_doe` (joins de leitura) · **Disparo:** atualmente mock — gera payload pra "MOCK_DOE_GATEWAY". **Análogo:** `Gerar Contrato PDF (Edge Function)` (PGF) EE Alta 6 PF — porém aqui é SE (saída pra sistema externo). **PF tentativa:** SE Alta 7 PF. · **needs_review:** true (não há call site no front; só roda via teste/integração externa)

### B08. Helper `is_admin` / `has_role` / `is_documento_owner`
**Tipo:** infraestrutura — **NÃO conta** (helpers de RLS, sem processo elementar próprio).

### B09. `log_auditoria`
**Tipo:** infraestrutura — **NÃO conta** (helper interno chamado por triggers).

---

## Itens não-mensuráveis (Guia Local Prodesp — V2 §3.7)

### Z01. Páginas estáticas (PAG)
- `/403` (Forbidden)
- `/funcionalidades` (Funcionalidades — descritiva)
- `*` NotFound
**Total:** 3 PAG × 0,6 = **1,8 PF**

### Z02. DCFI — funções SQL
**~23 funções SQL** definidas em migrations × 1,5 PF = **34,5 PF** (regra V2 §3.7).
- needs_review: confirmar se aplica todas ou só as que têm processo elementar próprio.

### Z03. HARDC — constantes user-facing
- Status documento: PENDENTE / FINALIZADO / PUBLICADO / etc (`STATUS_LABEL` em `Inicio.tsx`).
- Tipos de bloco: titulo_secao / paragrafo / divisor / imagem / tabela / texto / texto_longo / numero / data.
- Tipo de documento (enum no `modelos.tipo_documento`).
**Estimativa:** ~15-20 constantes únicas user-facing × 0,04 = ~0,6-0,8 PF, **capado em 5 PF** (V2 §3.7).

### Z04. DATDI — full-text search
RPC `buscar_documentos` provavelmente usa `tsvector`/`gin index`. Confirmar nas migrations. Se sim: **4,9 PF** por índice.

---

## Resumo provisório (a fechar no Marco 2)

| Categoria | Itens | Estimativa preliminar |
|---|---|---|
| ALI (D01-D12, ajustando RLR/needs_review) | ~10 contam | 7 × 10 = **70 PF** |
| AIE | 0 (sistema não consome APIs externas de domínio — apenas Supabase Auth/Storage) | 0 |
| EE (do front + edge + RPCs backend) | ~20-25 (depende da revisão dos B##) | ~6 × 22 = **132 PF** |
| SE | ~3-5 (Dashboard, Hub, Rastreabilidade, doe-export) | ~7 × 4 = **28 PF** |
| CE | ~10 (listagens) | ~6 × 10 = **60 PF** |
| Não mensuráveis (PAG/HARDC/DATDI/DCFI) | conforme acima | ~15-40 PF (DCFI domina) |
| **Total IFPUG provisório** | | **~290 PF + ajustes** |
| **Total com não mensuráveis** | | **~310-330 PF** |

> **Faixa esperada do plano V2 §8.1:** 150-300 PF. Estamos no teto/leve overshoot. Provável que reduza após:
> - Decisão sobre quais ALI/RPCs realmente contam (D02 já vira RLR; D10/D11 podem ser técnicas; D08 needs_review).
> - Decisão sobre DCFI (34,5 PF é alto — talvez só 8-10 funções SQL valham regra completa).
> - Confirmar se B01-B07 contam (workflow ainda não exposto no front pode ser deferido).

---

## Pontos pra revisão João

1. **Tramitação/Publicação DOE (B01-B06)** — workflow está definido no SQL mas sem UI. Conta ou difere?
2. **DCFI inflacionado** — 23 funções SQL × 1,5 = 34,5 PF parece exagerado. Aplicar regra só a funções com processo elementar próprio?
3. **D10/D11 (numeração técnica)** — ALI ou tabelas de infra que não contam?
4. **A14 (busca global)** — CE 6 PF ou SE 7 PF?
5. **A33 (versionar modelo)** — sem análogo direto. Tratar como EE Alta 6 PF?
6. **Z02 cap de DCFI** — sugiro cap em 10 PF (similar ao cap de HARDC).
