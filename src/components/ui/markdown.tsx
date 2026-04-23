"use client";

import ReactMarkdown from "react-markdown";

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => (
          <p className="whitespace-pre-wrap break-words mb-2 last:mb-0">{children}</p>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => (
          <ul className="list-disc pl-4 mb-2 last:mb-0">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-4 mb-2 last:mb-0">{children}</ol>
        ),
        li: ({ children }) => <li className="mb-0.5">{children}</li>,
        hr: () => <hr className="my-3 border-t border-border/40" />,
        table: ({ children }) => (
          <div className="overflow-hidden w-full mb-2 last:mb-0">
            <table className="w-full text-xs table-fixed">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="text-left font-semibold px-1 py-0.5 break-words">{children}</th>
        ),
        td: ({ children }) => (
          <td className="px-1 py-0.5 break-words">{children}</td>
        ),
        pre: ({ children }) => (
          <pre className="whitespace-pre-wrap break-words bg-black/10 dark:bg-white/10 rounded p-2 mb-2 last:mb-0 text-xs font-mono overflow-hidden">
            {children}
          </pre>
        ),
        code: ({ children }) => (
          <code className="bg-black/10 dark:bg-white/10 rounded px-1 py-0.5 text-xs font-mono break-all">
            {children}
          </code>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
