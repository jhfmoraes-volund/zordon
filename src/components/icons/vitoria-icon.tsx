import { forwardRef } from "react";
import { type LucideProps } from "lucide-react";

/**
 * Vitoria — Copiloto de Rituais de Planning.
 * Glifo "Omega rotacionado": anel fechado no topo com dois pés na base,
 * lendo como "V" de Vitoria. Família visual dos irmãos Alpha/Vitor.
 * Stroke-only, currentColor, padrão lucide.
 */
export const VitoriaIcon = forwardRef<SVGSVGElement, LucideProps>(
  (
    {
      color = "currentColor",
      size = 24,
      strokeWidth = 2,
      absoluteStrokeWidth,
      className,
      ...props
    },
    ref,
  ) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={
        absoluteStrokeWidth
          ? (Number(strokeWidth) * 24) / Number(size)
          : strokeWidth
      }
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {/* Arco superior — forma anel */}
      <path d="M6 8 A6 6 0 1 1 18 8" />
      {/* Pernas em V descendo do arco */}
      <path d="M6 8 L4 20" />
      <path d="M18 8 L20 20" />
      {/* Crossbar */}
      <path d="M7 14 L17 14" />
    </svg>
  ),
);

VitoriaIcon.displayName = "VitoriaIcon";
