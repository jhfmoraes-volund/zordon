"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Bot } from "lucide-react";
import { AlphaIcon } from "@/components/icons/alpha-icon";
import { VitorIcon } from "@/components/icons/vitor-icon";
import { cn } from "@/lib/utils";

type AgentHead = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  modelId: string;
};

function AgentTile({ slug }: { slug: string }) {
  const isAlpha = slug === "ops" || slug === "alpha";
  const isVitor = slug === "design-session" || slug === "vitor";

  if (!isAlpha && !isVitor) {
    return (
      <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Bot className="h-6 w-6" />
      </div>
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-md",
        "bg-[oklch(0.10_0_0)]",
        isAlpha
          ? "text-primary shadow-[inset_0_0_0_1px_oklch(0.637_0.237_22/0.30),0_0_14px_-4px_oklch(0.637_0.237_22/0.22)] bg-[linear-gradient(180deg,oklch(0.16_0.06_22/0.5),oklch(0.10_0_0)),repeating-linear-gradient(0deg,transparent_0_3px,oklch(0.637_0.237_22/0.05)_3px_4px)]"
          : "text-[oklch(0.74_0.18_55)] shadow-[inset_0_0_0_1px_oklch(0.74_0.18_55/0.30),0_0_14px_-4px_oklch(0.74_0.18_55/0.22)] bg-[linear-gradient(180deg,oklch(0.16_0.06_55/0.5),oklch(0.10_0_0)),repeating-linear-gradient(0deg,transparent_0_3px,oklch(0.74_0.18_55/0.05)_3px_4px)]",
      )}
    >
      {isAlpha ? <AlphaIcon size={26} /> : <VitorIcon size={26} />}
    </span>
  );
}

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { slug } = useParams<{ slug: string }>();
  const [agent, setAgent] = useState<AgentHead | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/agents/${slug}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setAgent(data.agent))
      .catch(() => setAgent(null));
  }, [slug]);

  const tabs = [
    { href: `/agents/${slug}/settings`, label: "Parâmetros" },
    { href: `/agents/${slug}/usage`, label: "Custos" },
    { href: `/agents/${slug}/heuristics`, label: "Playbooks", disabled: true },
    { href: `/agents/${slug}/versions`, label: "Versões", disabled: true },
  ];

  return (
    <div className="space-y-6">
      {/* Breadcrumb + header */}
      <div className="space-y-3">
        <Link
          href="/agents"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Agentes
        </Link>
        <div className="flex items-start gap-3">
          <AgentTile slug={slug} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">{agent?.name ?? slug}</h1>
            {agent?.description && (
              <p className="text-sm text-muted-foreground">{agent.description}</p>
            )}
            {agent?.modelId && (
              <p className="text-xs text-muted-foreground/70 font-mono mt-1">{agent.modelId}</p>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <nav className="border-b border-border">
        <ul className="flex gap-1 overflow-x-auto scrollbar-none -mx-3 px-3 md:mx-0 md:px-0">
          {tabs.map((t) => {
            const isActive = pathname === t.href;
            const base = "inline-block px-4 py-2 text-sm border-b-2 transition-colors whitespace-nowrap shrink-0";
            const active = "border-primary text-foreground font-medium";
            const inactive = "border-transparent text-muted-foreground hover:text-foreground";
            const disabled = "border-transparent text-muted-foreground/40 cursor-not-allowed";
            return (
              <li key={t.href} className="shrink-0">
                {t.disabled ? (
                  <span className={`${base} ${disabled}`} title="Em breve">
                    {t.label}
                    <span className="ml-1.5 text-[10px] uppercase tracking-wider">breve</span>
                  </span>
                ) : (
                  <Link href={t.href} className={`${base} ${isActive ? active : inactive}`}>
                    {t.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {children}
    </div>
  );
}
