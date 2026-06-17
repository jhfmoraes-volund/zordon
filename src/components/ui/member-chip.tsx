import { cn } from "@/lib/utils";
import { MemberAvatar } from "@/components/ui/member-avatar";

/**
 * Chip de membro reutilizável — pílula sutil (estilo executivo Notion/Linear),
 * avatar neutro à esquerda + nome + função. Vive em superfícies onde cor de
 * fundo vira ruído (header de projeto, listas de squad, assignees).
 *
 * Avatar: foto via `avatarUrl` (resolva com `publicPhotoUrl`); sem ela, o
 * MemberAvatar cai na inicial do nome.
 */

export type MemberChipProps = {
  name: string;
  /** Função/papel — ex. "PM", "Builder". Renderiza muted, após o nome. */
  role?: string | null;
  /** URL da foto já resolvida. Sem ela, cai nas iniciais. */
  avatarUrl?: string | null;
  size?: "sm" | "md";
  className?: string;
};

const SIZES = {
  sm: { pill: "h-6 gap-1.5 pl-0.5 pr-2 text-[11px]", avatar: "size-5 text-[9px]" },
  md: { pill: "h-7 gap-2 pl-1 pr-2.5 text-xs", avatar: "size-6 text-[10px]" },
} as const;

export function MemberChip({
  name,
  role,
  avatarUrl,
  size = "sm",
  className,
}: MemberChipProps) {
  const s = SIZES[size];
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full border border-border/70 bg-transparent font-medium leading-none whitespace-nowrap",
        s.pill,
        className,
      )}
    >
      <MemberAvatar name={name} avatarUrl={avatarUrl} className={s.avatar} />
      <span className="text-foreground">{name}</span>
      {role ? <span className="text-muted-foreground">· {role}</span> : null}
    </span>
  );
}
