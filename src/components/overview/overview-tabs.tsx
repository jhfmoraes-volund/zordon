import Link from "next/link";

export type OverviewTab = "ops" | "projetos";

const TABS: Array<{ key: OverviewTab; label: string }> = [
  { key: "projetos", label: "Projetos" },
  { key: "ops", label: "Operação" },
];

export function OverviewTabs({ current }: { current: OverviewTab }) {
  return (
    <nav className="border-b border-border">
      <ul className="flex gap-1 overflow-x-auto scrollbar-none">
        {TABS.map((t) => {
          const active = current === t.key;
          const href = t.key === "projetos" ? "/" : `/?tab=${t.key}`;
          const base =
            "inline-block px-4 py-2 text-sm border-b-2 transition-colors whitespace-nowrap shrink-0";
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
