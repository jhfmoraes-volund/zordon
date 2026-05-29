import Link from "next/link";

type Tab = "list" | "costs";

type Props = {
  current: Tab;
  /** Preserve query params (e.g. window=7d) when switching tabs. */
  preserve?: Record<string, string>;
};

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "list", label: "Lista" },
  { key: "costs", label: "Custos" },
];

export function AgentsHeaderTabs({ current, preserve }: Props) {
  return (
    <nav className="border-b border-border">
      <ul className="flex gap-1 overflow-x-auto scrollbar-none">
        {TABS.map((t) => {
          const active = current === t.key;
          const params = new URLSearchParams(preserve ?? {});
          if (t.key !== "list") params.set("tab", t.key);
          else params.delete("tab");
          const qs = params.toString();
          const href = `/agents${qs ? `?${qs}` : ""}`;
          const base = "inline-block px-4 py-2 text-sm border-b-2 transition-colors whitespace-nowrap shrink-0";
          return (
            <li key={t.key} className="shrink-0">
              <Link
                href={href}
                className={
                  active
                    ? `${base} border-primary text-foreground font-medium`
                    : `${base} border-transparent text-muted-foreground hover:text-foreground`
                }
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
