# GitHub App — setup (Volund/Vitória integration)

> Runbook pra você (humano) configurar o lado externo antes do código existir. Espelha o padrão do [Volund OS](https://github.com/volund-ia/volund-os) (`app/api/integrations/github/*` + `lib/integrations/github/app.ts`).
>
> **Quando este doc é útil**: você quer ligar a Vitória num repo real pra ela ler `AGENTS.md`, file tree e arquivos específicos como contexto de planning (Camada E do [intelligence-plan v2](../agents/vitoria/intelligence-plan.md)).
>
> **Quando NÃO é**: se o repo é público e você só quer um PoC, dá pra fazer com PAT global no `.env` (caminho mais simples — ver bloco "Alternativa simples" no final).

## Visão geral

Vamos criar um **GitHub App** (não um OAuth App clássico) com 2 fluxos sobrepostos:

1. **Installation flow** — o usuário instala o app numa conta (pessoal ou org), escolhe quais repos liberar. GitHub gera um `installation_id` por (app, conta).
2. **User authorization flow** (OAuth) — no mesmo redirect da instalação, GitHub manda um `code` que trocamos por um **user-to-server access_token** (8h) + **refresh_token** (6mo). O token tem o escopo dos repos que o usuário liberou.

Tokens vão pro DB **selados com AES-256-GCM** (mesma key do Supabase Vault). Cada usuário tem **1 conexão** — trocar de conta GitHub = desconectar + reconectar.

## Por que GitHub App (não OAuth App)?

| | OAuth App | GitHub App |
|---|---|---|
| Granularidade | All-or-nothing por escopo | Por repo + por permission |
| Rate limit | 5k/h compartilhado | 5k/h por install + JWT app pode mintar tokens de install |
| Refresh tokens | Não | Sim (com "Expire tokens" ON) |
| Multi-tenant | Ruim (todo mundo divide quota) | Ótimo (cada install isolada) |
| Webhooks | Por evento | Por evento + filtrados por install |

## Pré-requisitos

- Você tem acesso de admin a uma conta GitHub (pessoal ou org) que vai **hospedar** o App
- Volund rodando localmente em `http://localhost:3000` (ou Codespaces / túnel pra callbacks externos)
- Domínio de prod conhecido (ex `https://app.volund.com.br`)

## Passo 1 — Criar o GitHub App

1. Vá em [github.com/settings/apps/new](https://github.com/settings/apps/new) (se for pra org, use `github.com/organizations/<org>/settings/apps/new`).
2. Preencha:

| Campo | Valor |
|---|---|
| **GitHub App name** | `Volund Vitoria` (ou outro nome único — vai virar o slug) |
| **Description** | "Integração de leitura de repo pro copiloto de planning Vitória" |
| **Homepage URL** | `https://app.volund.com.br` (ou seu domínio) |
| **Callback URL** | `https://app.volund.com.br/api/integrations/github/callback` |
| → adicione também | `http://localhost:3000/api/integrations/github/callback` |
| **Request user authorization (OAuth) during installation** | ✅ **ON** |
| **Expire user authorization tokens** | ✅ **ON** (gera `refresh_token` de 6mo) |
| **Setup URL** | (deixe vazio) |
| **Webhook → Active** | ❌ **OFF** por ora (não precisa pra MVP de leitura) |
| **Where can this GitHub App be installed?** | "Any account" se for SaaS; "Only on this account" se for interno |

3. **Permissions** → Repository permissions:

| Permission | Access |
|---|---|
| Contents | **Read-only** |
| Metadata | **Read-only** (auto-selecionado) |
| Pull requests | Read-only *(opcional — se quiser que a Vitória veja PRs depois)* |
| Issues | Read-only *(opcional — pra puxar issues como contexto)* |

Account permissions: deixe tudo `No access` por ora.

4. Salve → GitHub te leva pra **App settings page** com 3 valores importantes no topo:
   - **App ID** (numérico)
   - **Client ID** (`Iv23...`)
   - **App slug** (vem da URL, ex `volund-vitoria`)

## Passo 2 — Gerar Client Secret e Private Key

Ainda na **App settings page**:

1. **Client secrets** → "Generate a new client secret" → copia (só aparece uma vez)
2. **Private keys** → "Generate a private key" → baixa o `.pem`
3. Converte o PEM pra base64 (uma linha só, mais fácil pra env var):

```bash
cat ~/Downloads/volund-vitoria.<...>.private-key.pem | base64 | tr -d '\n'
```

Guarda o output — vai pra `GITHUB_APP_PRIVATE_KEY`.

## Passo 3 — Gerar secrets locais

Você precisa de 2 secrets aleatórios:

```bash
# VAULT_MASTER_KEY: 32 bytes hex (AES-256). Use só se ainda NÃO tem no .env
openssl rand -hex 32

# GITHUB_APP_STATE_SECRET: HMAC do state OAuth. 32 bytes random
openssl rand -base64 32
```

> **Importante**: se já existe `VAULT_MASTER_KEY` no `.env` (outras features usam), **reuse** — não gere um novo, senão você quebra tokens já selados de outras features.

## Passo 4 — Configurar `.env`

Adicione no `.env` (local) e nas envs de prod (Vercel/Cloud Run/etc):

```bash
# ─── GitHub App ──────────────────────────────────────────
GITHUB_APP_ID=123456                              # numérico do passo 1
GITHUB_APP_SLUG=volund-vitoria                    # slug da URL
GITHUB_APP_CLIENT_ID=Iv23liXXXXXXXXXXXX           # passo 1
GITHUB_APP_CLIENT_SECRET=ghs_XXXXXXXXXXXXXXXXX    # passo 2.1
GITHUB_APP_PRIVATE_KEY=LS0tLS1CRUdJTi...          # passo 2.3 (base64 do PEM, sem quebras)

# HMAC pro state round-trip no callback. Pode cair em fallback (APP_URL+VAULT_MASTER_KEY)
# mas explícito é mais seguro.
GITHUB_APP_STATE_SECRET=<output do openssl rand -base64 32>

# AES seal de tokens. REUSE se já existe.
VAULT_MASTER_KEY=<64 chars hex>

# Já deve existir
APP_URL=https://app.volund.com.br                 # NÃO usar localhost aqui em prod
```

E em `.env.example` (commit) — sem valores, só placeholders.

## Passo 5 — Validar o setup (sem código ainda)

Antes mesmo de codar a integração, dá pra validar que os secrets funcionam:

```bash
# Decodifica o PEM e tenta mintar um JWT do App
node -e '
  const jwt = require("jsonwebtoken");
  const pem = Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY, "base64").toString("utf8");
  const token = jwt.sign({}, pem, {
    algorithm: "RS256",
    expiresIn: "5m",
    issuer: process.env.GITHUB_APP_ID,
  });
  console.log(token);
' | tee /tmp/gh-app-jwt.txt

# Lista installations do App (se vazio, App não foi instalado ainda — esperado nesta fase)
curl -s -H "Authorization: Bearer $(cat /tmp/gh-app-jwt.txt)" \
     -H "Accept: application/vnd.github+json" \
     https://api.github.com/app/installations | jq
```

Se rodar sem 401, secrets estão certos. Se der `401 Bad credentials`, normalmente é PEM mal codificado em base64 (linhas extras).

> **Nota sobre `jsonwebtoken`**: ainda não está no `package.json`. Quando GH-1 for codar, vamos adicionar (`npm i jsonwebtoken @octokit/rest @octokit/auth-app`). Pra validação aqui dá pra `npx -y jsonwebtoken-cli` se preferir não instalar nada permanente.

## Passo 6 — Instalar o App em pelo menos 1 conta de teste

1. Vá em `https://github.com/apps/<seu-slug>` (público pra qualquer logado ver)
2. "Install" → escolha conta + repos (recomendo começar com 1 repo de teste, "Only select repositories")
3. GitHub redireciona pro callback. Como ainda não há código, vai dar 404 — **OK pra essa fase**. O importante é que a installation foi criada.
4. Volte em `Settings → Applications → Installed GitHub Apps` da sua conta — deve aparecer o app instalado.
5. Reroda o `curl` do passo 5 — agora a lista deve ter 1+ installations.

## Passo 7 — Conferir o checklist final

Antes de partir pro código (GH-1 do plano de fases):

- [ ] `GITHUB_APP_ID` numérico no `.env` local **e** prod
- [ ] `GITHUB_APP_SLUG` bate com a URL do app
- [ ] `GITHUB_APP_CLIENT_ID` e `GITHUB_APP_CLIENT_SECRET` presentes
- [ ] `GITHUB_APP_PRIVATE_KEY` (base64 de 1 linha) carrega sem erro
- [ ] `VAULT_MASTER_KEY` (32 bytes hex) — reusado ou novo, mas **igual em todos os envs**
- [ ] `GITHUB_APP_STATE_SECRET` presente
- [ ] Callback URL **tem ambos** (prod + localhost)
- [ ] "Expire user authorization tokens" está **ON**
- [ ] App está instalado em pelo menos 1 conta de teste
- [ ] `curl` do passo 5 retorna a installation sem erro

## Notas operacionais

### Renovar a Client Secret

GitHub não expira a client secret automaticamente, mas se vazar (ou se você quiser rotacionar a cada 6mo):

1. App settings → Client secrets → "Generate a new client secret"
2. Atualize `GITHUB_APP_CLIENT_SECRET` no `.env` e prod **antes** de revogar a antiga
3. Revogue a antiga só depois que deploy estiver de pé

### Renovar a Private Key

Mesma lógica. GitHub permite **2 private keys ativas** ao mesmo tempo pra rotação sem downtime:

1. Generate new private key → atualiza `GITHUB_APP_PRIVATE_KEY`
2. Deploy
3. Revoga a antiga

### Token refresh em runtime

Quando codarmos `lib/integrations/github/app.ts`, ele vai automaticamente:
1. Antes de cada call, checar `access_token_expires_at`
2. Se < 5min: usa `refresh_token` pra trocar por novo `access_token`
3. Reselar ambos no DB

`refresh_token` dura 6 meses. Se o usuário ficar 6mo sem usar, ele precisa reconectar.

## Alternativa simples (PAT global)

Se você só quer um PoC rápido com 1 repo público ou um repo da sua org sem cerimônia multi-tenant:

1. Gera um [fine-grained PAT](https://github.com/settings/tokens?type=beta) com `Contents: Read` no(s) repo(s) específicos
2. Adiciona `GITHUB_TOKEN=ghp_...` no `.env`
3. Octokit usa esse token diretamente — sem OAuth, sem migration, sem UI de conectar

**Tradeoff**: todo usuário do Volund usa o mesmo token (mesma identidade no GitHub). Sem auditoria por pessoa. Não escala pra clientes diferentes.

Vale a pena se: é um PoC, é uso interno (1 org), e você não quer gastar as ~5h da Fase GH-1 antes de validar valor.

## Referências

- Volund OS migration: [supabase/migrations/20260525204944_add_github_integration.sql](https://github.com/volund-ia/volund-os/blob/main/supabase/migrations/20260525204944_add_github_integration.sql)
- Volund OS lib: [lib/integrations/github/app.ts](https://github.com/volund-ia/volund-os/blob/main/lib/integrations/github/app.ts)
- Volund OS rotas: [app/api/integrations/github/](https://github.com/volund-ia/volund-os/tree/main/app/api/integrations/github)
- Plano de fases (perke): [`docs/agents/vitoria/intelligence-plan.md`](../agents/vitoria/intelligence-plan.md) — Camada E, GH-1/GH-2/GH-3
- GitHub docs: [Creating a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app), [Identifying users](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/identifying-and-authorizing-users-for-github-apps)

## Quando este doc estiver concluído

Volte ao plano principal e diga "vamos GH-1" — o código vai consumir exatamente os env vars deste doc e seguir o padrão do Volund OS adaptado.
