"use client";

/**
 * Battery-style visualization of a member's FP commitment.
 *
 * capacity   = Member.fpCapacity (teto total por sprint)
 * committed  = SUM(ProjectMember.fpAllocation) — quanto já está comprometido em projetos
 * breakdown  = segmentos opcionais (por projeto) para renderizar a barra empilhada
 *
 * Quando committed > capacity, renderiza um indicador de overcommit.
 */
export type BatterySegment = {
  label: string;
  value: number;
  /** Tailwind color class (bg-*); se omitido, ciclamos entre 4 tons. */
  colorClass?: string;
};

export function MemberBattery({
  capacity,
  committed,
  breakdown,
  size = "md",
  showNumbers = true,
}: {
  capacity: number;
  committed: number;
  breakdown?: BatterySegment[];
  size?: "sm" | "md";
  showNumbers?: boolean;
}) {
  const safeCapacity = Math.max(capacity, 1);
  const overcommit = committed > capacity;
  const filledPct = Math.min(committed / safeCapacity, 1) * 100;
  const spillPct = overcommit ? ((committed - capacity) / safeCapacity) * 100 : 0;

  const trackH = size === "sm" ? "h-2" : "h-3";
  const textSize = size === "sm" ? "text-[10px]" : "text-xs";

  // Default palette when no segment colors are given
  const palette = [
    "bg-primary",
    "bg-indigo-500",
    "bg-teal-500",
    "bg-amber-500",
    "bg-pink-500",
  ];

  const totalBreakdown = (breakdown ?? []).reduce((s, b) => s + b.value, 0);
  const useBreakdown = breakdown && breakdown.length > 0 && totalBreakdown > 0;

  return (
    <div className="w-full space-y-1">
      {/* Track */}
      <div className={`relative ${trackH} w-full rounded-full bg-muted overflow-hidden`}>
        {useBreakdown ? (
          <div className="absolute inset-0 flex">
            {breakdown.map((seg, i) => {
              const pct = (seg.value / safeCapacity) * 100;
              return (
                <div
                  key={`${seg.label}-${i}`}
                  className={`${seg.colorClass ?? palette[i % palette.length]} transition-all`}
                  style={{ width: `${Math.min(pct, 100 - (spillPct > 0 ? 0 : 0))}%` }}
                  title={`${seg.label}: ${seg.value} FP`}
                />
              );
            })}
          </div>
        ) : (
          <div
            className={`absolute inset-y-0 left-0 ${overcommit ? "bg-red-500" : "bg-primary"} transition-all`}
            style={{ width: `${filledPct}%` }}
          />
        )}

        {/* Overcommit spill — desenhado sobre o limite com padrão vermelho */}
        {overcommit && (
          <div
            className="absolute inset-y-0 right-0 bg-red-500/70 border-l-2 border-red-700"
            style={{ width: `${Math.min(spillPct, 40)}%` }}
            title={`Overcommit: +${committed - capacity} FP`}
          />
        )}
      </div>

      {/* Numbers + status */}
      {showNumbers && (
        <div className={`flex items-center justify-between ${textSize} text-muted-foreground`}>
          <span>
            <span className={overcommit ? "text-red-600 font-semibold" : "text-foreground font-medium"}>
              {committed}
            </span>
            <span> / {capacity} FP</span>
          </span>
          {overcommit ? (
            <span className="text-red-600 font-medium">+{committed - capacity} overcommit</span>
          ) : committed === capacity ? (
            <span className="text-amber-600">bateria cheia</span>
          ) : (
            <span>{capacity - committed} livre</span>
          )}
        </div>
      )}
    </div>
  );
}
