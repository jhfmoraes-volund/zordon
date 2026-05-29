import Link from "next/link";
import type { Window } from "@/lib/agent/usage-aggregation";
import { WINDOWS } from "@/lib/agent/usage-aggregation";

type Props = {
  current: Window;
  basePath?: string;
  extraQuery?: Record<string, string>;
};

export function WindowTabs({ current, basePath = "/agents", extraQuery }: Props) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5">
      {(Object.keys(WINDOWS) as Window[]).map((w) => {
        const active = w === current;
        const params = new URLSearchParams({ ...(extraQuery ?? {}), window: w });
        return (
          <Link
            key={w}
            href={`${basePath}?${params.toString()}`}
            className={
              "px-3 py-1.5 text-xs font-medium rounded transition-colors " +
              (active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {WINDOWS[w].label.replace("Últimas ", "").replace("Últimos ", "")}
          </Link>
        );
      })}
    </div>
  );
}
