import { Flame } from "lucide-react";

export function ForgeLogo() {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">FORGE</h1>
        <span className="rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          DEV
        </span>
      </div>
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Flame className="size-3.5" aria-hidden />
        Agent Factory — agentes e subagentes em tempo real.
      </p>
    </div>
  );
}
