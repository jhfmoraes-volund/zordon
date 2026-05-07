"use client";

import { useMemo, useState } from "react";
import type { UIMessage } from "ai";
import { Button } from "@/components/ui/button";
import {
  ConversationFab,
  ConversationPanel,
  type AgentId,
} from "@/components/ui/conversation";
import { useIsMobile } from "@/hooks/use-mobile";

const TOOL_NAMES = [
  "set_field",
  "add_item",
  "update_item",
  "get_step_data",
  "web_search",
  "create_task",
];

function makeText(seed: number) {
  const lines = [
    "Vou propor a estrutura inicial dos módulos com base no brainstorm.",
    "Aqui vão os critérios de aceite que identifiquei.",
    "Refinando essa story em tasks técnicas autossuficientes.",
    "Encontrei 3 cards relevantes no brainstorm. Vou sintetizar.",
    "Vou consolidar tudo num único módulo coeso pra evitar duplicação.",
  ];
  const main = lines[seed % lines.length];
  const detail = `\n\n**Detalhe ${seed + 1}**\n\n- Item A\n- Item B\n- Item C`;
  return `${main}${detail}`;
}

function makeMessages(count: number): UIMessage[] {
  const out: UIMessage[] = [];
  for (let i = 0; i < count; i++) {
    const isUser = i % 2 === 0;
    if (isUser) {
      out.push({
        id: `u-${i}`,
        role: "user",
        parts: [{ type: "text", text: `Pergunta #${i / 2 + 1}` }],
      } as UIMessage);
    } else {
      const toolCount = i % 4 === 0 ? 5 : i % 5 === 0 ? 1 : 2;
      const parts: unknown[] = [{ type: "text", text: makeText(i) }];
      for (let t = 0; t < toolCount; t++) {
        const tn = TOOL_NAMES[(i + t) % TOOL_NAMES.length];
        parts.push({
          type: `tool-${tn}`,
          toolCallId: `${i}-${t}`,
          toolName: tn,
          input: {
            stepKey: "vision",
            arrayKey: "modules",
            field: "title",
            query: "auth",
          },
          state: "result",
        });
      }
      out.push({
        id: `a-${i}`,
        role: "assistant",
        parts,
      } as unknown as UIMessage);
    }
  }
  return out;
}

export default function ChatStressPage() {
  const [agent, setAgent] = useState<AgentId>("vitor");
  const [count, setCount] = useState(200);
  const [input, setInput] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();
  const messages = useMemo(() => makeMessages(count), [count]);

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Chat stress harness
        </h1>
        <p className="text-sm text-muted-foreground">
          {messages.length} mensagens mockadas, ~50% assistant com tool calls
          variados. Use pra validar virtualizer + memo + sticky-bottom.
        </p>
      </header>

      <section className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant={agent === "vitor" ? "default" : "outline"}
          onClick={() => setAgent("vitor")}
        >
          Vitor
        </Button>
        <Button
          size="sm"
          variant={agent === "alpha" ? "default" : "outline"}
          onClick={() => setAgent("alpha")}
        >
          Alpha
        </Button>
        {[50, 200, 500].map((n) => (
          <Button
            key={n}
            size="sm"
            variant={count === n ? "default" : "outline"}
            onClick={() => setCount(n)}
          >
            {n} msgs
          </Button>
        ))}
      </section>

      <section className="h-[640px] overflow-hidden rounded-xl border">
        <ConversationPanel
          agent={agent}
          variant={isMobile ? "mobile" : "desktop"}
          messages={messages}
          status="idle"
          input={input}
          onInputChange={setInput}
          onSubmit={() => setInput("")}
          isOpen={mobileOpen}
          onOpenChange={setMobileOpen}
        />
      </section>

      {isMobile && !mobileOpen && (
        <ConversationFab
          agent={agent}
          isOpen={mobileOpen}
          isStreaming={false}
          onClick={() => setMobileOpen(true)}
        />
      )}
    </div>
  );
}
