"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// GFM (tabelas, strikethrough, task lists, autolinks) — sem isso, tabela
// pipe de report de agente renderiza como parágrafo de texto cru.
const remarkPlugins = [remarkGfm];

const COLLAPSED_PREVIEW_CHARS = 5000;

const components = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-lg font-semibold mt-4 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-base font-semibold mt-4 mb-1.5 first:mt-0">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-sm font-semibold mt-3 mb-1 first:mt-0">{children}</h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="whitespace-pre-wrap break-words mb-2 last:mb-0">{children}</p>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc pl-4 mb-2 last:mb-0">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal pl-4 mb-2 last:mb-0">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li className="mb-0.5">{children}</li>,
  hr: () => <hr className="my-3 border-t border-border/40" />,
  // Tabelas no padrão console (HUD da Forge): header uppercase tracking-wider,
  // hairlines, células densas com align-top.
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="mb-2 w-full overflow-x-auto rounded-md border border-border/60 last:mb-0">
      <table className="w-full text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-muted/30">{children}</thead>
  ),
  tbody: ({ children }: { children?: React.ReactNode }) => (
    <tbody className="divide-y divide-border/40">{children}</tbody>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="break-words border-b border-border/60 px-2 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="break-words px-2 py-1.5 align-top">{children}</td>
  ),
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="whitespace-pre-wrap break-words bg-black/10 dark:bg-white/10 rounded p-2 mb-2 last:mb-0 text-xs font-mono overflow-hidden">
      {children}
    </pre>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="bg-black/10 dark:bg-white/10 rounded px-1 py-0.5 text-xs font-mono break-all">
      {children}
    </code>
  ),
};

/**
 * Markdown com fallback opcional pra mensagens grandes.
 *
 * Quando `maxChars` é definido E `children.length > maxChars`, renderiza
 * só os primeiros `COLLAPSED_PREVIEW_CHARS` chars com botão "ver completo".
 * Sem `maxChars`, comportamento normal (renderiza tudo). Use `maxChars` em
 * contextos com muitas mensagens (chat) — não em páginas dedicadas a texto longo
 * (memoria, ops, etc).
 */
export function Markdown({
  children,
  maxChars,
}: {
  children: string;
  maxChars?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  const shouldCollapse =
    typeof maxChars === "number" && children.length > maxChars && !expanded;

  if (shouldCollapse) {
    const preview = children.slice(0, COLLAPSED_PREVIEW_CHARS);
    const remainingChars = children.length - COLLAPSED_PREVIEW_CHARS;
    return (
      <>
        <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
          {preview}
        </ReactMarkdown>
        <div className="my-2 border-t border-border/30 pt-2">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-xs font-medium text-primary hover:underline"
          >
            Ver completo · +{remainingChars.toLocaleString("pt-BR")} caracteres
          </button>
        </div>
      </>
    );
  }

  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {children}
    </ReactMarkdown>
  );
}
