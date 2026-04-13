export const DEFAULT_GUIDELINES = [
  {
    category: "design",
    title: "Design System",
    content: `## Layout
- Usar shadcn/ui como base de componentes
- Espaçamento: 4px grid (p-1, p-2, p-4, p-6, p-8)
- Border radius: rounded-md padrão, rounded-lg para cards
- Cores de status: gray=neutro, blue=info, yellow=warning, green=success, red=error

## Tipografia
- Títulos: font-semibold ou font-bold
- Body: text-sm para tabelas, text-base para formulários
- Muted: text-muted-foreground para labels secundárias

## Componentes
- Tabelas: shadcn Table com header sticky
- Forms: Dialog modal com Label + Input/Select/Textarea
- Feedback: Badge para status, Toast para ações
- Loading: Skeleton para carregamento inicial

## Responsividade
- Mobile-first quando possível
- Grid adaptativo: grid-cols-1 → grid-cols-2 → grid-cols-3+
- Tabelas com scroll horizontal em mobile`,
  },
  {
    category: "security",
    title: "Segurança",
    content: `## Dados Sensíveis
- CPF: mascarar como ***.***.XXX-XX
- Email: mostrar completo apenas para admins
- Telefone: mascarar como (**) ****-XXXX
- Senhas: nunca logar, nunca retornar em API

## Validação
- Sanitizar inputs no servidor (nunca confiar no client)
- Validar tipos e ranges antes de queries
- Usar prepared statements (Prisma faz por padrão)

## API
- Rate limit em endpoints públicos
- Não expor IDs internos em mensagens de erro
- Retornar 404 genérico para recursos não encontrados
- Nunca retornar stack traces em produção`,
  },
  {
    category: "libraries",
    title: "Bibliotecas & Stack",
    content: `## Frontend
- Framework: Next.js (App Router)
- Componentes: shadcn/ui + Radix primitives
- Styling: Tailwind CSS
- Ícones: lucide-react
- Forms: React Hook Form (se complexo), useState (se simples)
- Drag & Drop: @dnd-kit

## Backend
- ORM: Prisma
- Validação: Zod (quando necessário)
- API: Next.js Route Handlers
- AI: OpenAI SDK (gpt-4o)

## Não Usar
- jQuery, Bootstrap, Material UI
- axios (usar fetch nativo)
- moment.js (usar date-fns ou Intl)
- CSS modules (usar Tailwind)`,
  },
  {
    category: "icons",
    title: "Ícones & Iconografia",
    content: `## Biblioteca
- Usar exclusivamente lucide-react
- Tamanho padrão: h-4 w-4 (inline), h-5 w-5 (botões), h-6 w-6 (headers)

## Convenções por Contexto
- Ações: Pencil (editar), Trash2 (deletar), Plus (adicionar), Eye (visualizar)
- Status: CheckCircle2 (sucesso), XCircle (erro), AlertTriangle (warning), Loader2 (loading)
- Navegação: ArrowLeft (voltar), ChevronRight (expandir), ExternalLink (link externo)
- Entidades: Users (pessoas), FolderOpen (projetos), Bot (agentes), GitPullRequest (PRs)
- Comunicação: MessageSquare (comentário), Bell (notificação), Mail (email)

## Padrões
- Ícone + texto em botões de ação: className="gap-2"
- Ícone sozinho: usar Button size="icon"
- Cor: herdar do texto pai, usar text-muted-foreground para ícones decorativos`,
  },
  {
    category: "rate-limit",
    title: "Rate Limiting & Performance",
    content: `## API
- Debounce em auto-save: 500ms
- Paginação padrão: 20 itens por página
- Requests paralelos: máximo 3 simultâneos
- Timeout: 30s para operações normais, 120s para geração IA

## Frontend
- Não fazer fetch em loop — usar Promise.all
- Evitar re-renders desnecessários com useCallback/useMemo
- Lazy load para componentes pesados
- Skeleton loading para dados assíncronos

## Database
- Usar select/include seletivo no Prisma (não carregar tudo)
- Índices em campos de busca frequente
- Evitar queries N+1 (usar include ao invés de queries separadas)`,
  },
  {
    category: "conventions",
    title: "Convenções de Código",
    content: `## Nomenclatura
- Componentes: PascalCase (TaskCard, SprintBoard)
- Arquivos: kebab-case (task-card.tsx, sprint-board.tsx)
- Variáveis/funções: camelCase
- Constantes: UPPER_SNAKE_CASE
- Tipos: PascalCase com sufixo descritivo (TaskStatus, ProjectSquad)

## Estrutura de API Route
- GET: findMany com include, ordenar por relevância
- POST: create com validação mínima, retornar 201
- PUT: update parcial, retornar objeto atualizado
- DELETE: hard delete, retornar { ok: true }

## Padrões
- "use client" apenas quando necessário (estado, eventos)
- Fetch direto com .then() para loads simples
- Dialog para formulários, não páginas separadas
- Erros não-bloqueantes: try/catch com console.error, não crash`,
  },
  {
    category: "architecture",
    title: "Arquitetura & Patterns",
    content: `## Estrutura de Páginas
- Páginas de listagem: Tabela com filtros + Dialog para CRUD
- Páginas de detalhe: Tabs com seções (Overview, Items, Settings)
- Wizards: Step-based com navegação lateral e auto-save

## Estado
- Server state: fetch no useEffect, reload após mutação
- Form state: useState com objeto, spread updates
- Sem state management global (sem Redux/Zustand no geral)

## Database
- SQLite para desenvolvimento
- Prisma como ORM
- Relações com cascade delete onde faz sentido
- Campos JSON como String (SQLite)

## Arquivos
- Páginas em src/app/(dashboard)/
- Componentes reutilizáveis em src/components/
- Services/utils em src/lib/
- API routes em src/app/api/`,
  },
] as const;

export type GuidelineCategory = (typeof DEFAULT_GUIDELINES)[number]["category"];
