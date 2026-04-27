import { forwardRef } from "react";
import { type LucideProps } from "lucide-react";

/**
 * Alpha — agente operacional do Zordon.
 * Glifo "Offset Alpha": triângulo com travessa do α e perna direita
 * estendida abaixo da base. Stroke-only, currentColor, padrão lucide.
 */
export const AlphaIcon = forwardRef<SVGSVGElement, LucideProps>(
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
      <path d="M11 4 L4 18 L17 18" />
      <path d="M11 4 L20 22" />
      <path d="M7.5 13 L15 13" />
    </svg>
  ),
);

AlphaIcon.displayName = "AlphaIcon";
