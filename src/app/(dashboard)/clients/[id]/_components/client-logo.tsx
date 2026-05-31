"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const SIZE_CLASS = {
  sm: "size-8 text-xs",
  md: "size-12 text-base",
  lg: "size-16 text-xl",
} as const;

type Size = keyof typeof SIZE_CLASS;

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

type ClientLogoProps = {
  name: string;
  logoStoragePath: string | null;
  logoUpdatedAt: string | null;
  size?: Size;
  className?: string;
};

export function ClientLogo({
  name,
  logoStoragePath,
  logoUpdatedAt,
  size = "md",
  className,
}: ClientLogoProps) {
  const publicUrl = useMemo(() => {
    if (!logoStoragePath) return null;
    const supabase = createClient();
    const { data } = supabase.storage
      .from("client-logos")
      .getPublicUrl(logoStoragePath);
    const base = data.publicUrl;
    return logoUpdatedAt
      ? `${base}?v=${encodeURIComponent(logoUpdatedAt)}`
      : base;
  }, [logoStoragePath, logoUpdatedAt]);

  const baseClasses = cn(
    "shrink-0 overflow-hidden rounded-lg border bg-muted",
    SIZE_CLASS[size],
    className,
  );

  if (publicUrl) {
    return (
      <span className={baseClasses}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Supabase public URL, sem next/image otimizado por enquanto */}
        <img
          src={publicUrl}
          alt={`Logo ${name}`}
          className="size-full object-cover"
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        baseClasses,
        "flex items-center justify-center font-semibold text-muted-foreground",
      )}
      aria-label={`Logo placeholder ${name}`}
    >
      {getInitials(name)}
    </span>
  );
}
