import { forwardRef } from "react";
import { type LucideProps } from "lucide-react";

/**
 * Vitor — agente de design de produto.
 * Glifo "Inverted Alpha": triângulo invertido (apex apontando pra baixo,
 * lendo como V) com travessa do α e perna direita estendida acima do topo.
 * Família visual idêntica ao AlphaIcon, espelhada no eixo horizontal.
 * Stroke-only, currentColor, padrão lucide.
 */
export const VitorIcon = forwardRef<SVGSVGElement, LucideProps>(
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
      <path d="M11 20 L4 6 L17 6" />
      <path d="M11 20 L20 2" />
      <path d="M7.5 11 L15 11" />
    </svg>
  ),
);

VitorIcon.displayName = "VitorIcon";
