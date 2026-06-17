"use client";

import { publicPhotoUrl } from "@/lib/storage/photo";
import { cn } from "@/lib/utils";

export const OPEN_SOURCE_BUCKET = "open-source-photos";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

type OpenSourcePhotoProps = {
  name: string;
  photoStoragePath: string | null;
  photoUpdatedAt: string | null;
  className?: string;
};

export function OpenSourcePhoto({
  name,
  photoStoragePath,
  photoUpdatedAt,
  className,
}: OpenSourcePhotoProps) {
  const publicUrl = publicPhotoUrl(
    OPEN_SOURCE_BUCKET,
    photoStoragePath,
    photoUpdatedAt,
  );

  const base = cn(
    "shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]",
    className,
  );

  if (publicUrl) {
    return (
      <span className={base}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Supabase public URL */}
        <img
          src={publicUrl}
          alt={name}
          className="size-full object-cover"
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        base,
        "flex items-center justify-center font-semibold text-white/40",
      )}
      aria-label={`Foto de ${name}`}
    >
      {getInitials(name)}
    </span>
  );
}
