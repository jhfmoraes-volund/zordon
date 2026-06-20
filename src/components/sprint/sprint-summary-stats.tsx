import { Activity, ListTodo, Sparkles, Zap } from "lucide-react";

type Stats = {
  sprints: number;
  totalTasks: number;
  doneTasks: number;
  totalFP: number;
  doneFP: number;
};

type Props = {
  stats: Stats;
};

export function SprintSummaryStats({ stats }: Props) {
  const pct =
    stats.totalTasks > 0
      ? Math.round((stats.doneTasks / stats.totalTasks) * 100)
      : 0;

  const cards: {
    icon: typeof Zap;
    label: string;
    value: string;
    sub?: string;
  }[] = [
    { icon: Zap,      label: "Sprints",      value: String(stats.sprints) },
    { icon: ListTodo, label: "Tasks",        value: String(stats.doneTasks), sub: `/ ${stats.totalTasks}` },
    { icon: Sparkles, label: "PFV entregues", value: String(stats.doneFP),    sub: `/ ${stats.totalFP}` },
    { icon: Activity, label: "Progresso",    value: `${pct}%` },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="flex items-center gap-3 rounded-xl border bg-card p-3"
        >
          <c.icon className="size-4 text-muted-foreground" />
          <div className="flex-1 space-y-0.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {c.label}
            </p>
            <p className="text-lg font-bold tabular-nums">
              {c.value}
              {c.sub ? (
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}
                  {c.sub}
                </span>
              ) : null}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
