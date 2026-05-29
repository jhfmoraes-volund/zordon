"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, User, Palette, Plug } from "lucide-react";
import { cn } from "@/lib/utils";

const sections = [
  { href: "/settings/account", label: "Conta", icon: User },
  { href: "/settings/appearance", label: "Aparência", icon: Palette },
  { href: "/settings/integrations", label: "Integrações", icon: Plug },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Settings className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Configurações</h1>
          <p className="text-sm text-muted-foreground">Preferências e integrações da sua conta</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        <nav className="md:sticky md:top-4 md:self-start">
          <ul className="flex gap-1 overflow-x-auto md:flex-col md:gap-0.5 md:overflow-visible">
            {sections.map((s) => {
              const isActive = pathname === s.href || pathname.startsWith(`${s.href}/`);
              const Icon = s.icon;
              return (
                <li key={s.href} className="shrink-0">
                  <Link
                    href={s.href}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors whitespace-nowrap md:flex md:w-full",
                      isActive
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {s.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
