import { cn } from "@/lib/utils";

/** Iniciais: 1 palavra → 2 chars; 2+ palavras → primeira + última. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export type MemberAvatarProps = {
  name: string;
  /** URL já resolvida da foto (ver `publicPhotoUrl`). Sem ela, cai nas iniciais. */
  avatarUrl?: string | null;
  /** Dimensione por aqui: `size-5` no chip, `size-16` no perfil. */
  className?: string;
};

/**
 * Avatar redondo neutro de membro: foto se houver, senão iniciais sobre fundo
 * muted. Primitivo compartilhado (MemberChip, MemberPhotoField, …).
 */
export function MemberAvatar({ name, avatarUrl, className }: MemberAvatarProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-full bg-muted font-semibold text-foreground/70",
        className,
      )}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
        <img src={avatarUrl} alt="" className="size-full object-cover" />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
