"use client";

import { Check } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTheme } from "@/contexts/theme-context";
import { THEMES, type ThemeId } from "@/lib/theme/themes";
import { cn } from "@/lib/utils";

export function AppearanceCard() {
  const { theme, setTheme, pending } = useTheme();

  const handleSelect = async (id: ThemeId) => {
    if (id === theme || pending) return;
    const ok = await setTheme(id);
    if (!ok) {
      toast.error("Não foi possível salvar o tema. Tente novamente.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Aparência</CardTitle>
        <p className="text-sm text-muted-foreground">
          Escolha o tema da interface. Sua preferência é salva e sincronizada entre dispositivos.
        </p>
      </CardHeader>
      <CardContent>
        <div
          role="radiogroup"
          aria-label="Tema da interface"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {THEMES.map((t) => {
            const selected = t.id === theme;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => handleSelect(t.id)}
                disabled={pending}
                className={cn(
                  "group relative flex flex-col gap-3 rounded-lg border bg-card p-3 text-left transition",
                  "hover:border-foreground/30",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  selected
                    ? "border-primary ring-2 ring-primary/40"
                    : "border-border",
                  pending && "cursor-not-allowed opacity-60",
                )}
              >
                {/* Preview row — 3 chips com as cores principais do tema. */}
                <div className="flex h-10 overflow-hidden rounded-md ring-1 ring-foreground/10">
                  {t.swatches.map((hex, i) => (
                    <div
                      key={i}
                      className="flex-1"
                      style={{ backgroundColor: hex }}
                      aria-hidden
                    />
                  ))}
                </div>

                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{t.name}</div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {t.description}
                    </p>
                  </div>
                  {selected ? (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" aria-hidden />
                    </span>
                  ) : (
                    <span className="h-5 w-5 shrink-0 rounded-full border border-border" aria-hidden />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
