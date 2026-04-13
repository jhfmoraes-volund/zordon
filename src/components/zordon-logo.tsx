export function ZordonLogo({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-bold tracking-[0.15em] uppercase text-foreground ${className}`}
      style={{ fontFamily: "var(--font-geist-sans), system-ui, sans-serif" }}
    >
      ZORDON
    </span>
  );
}
