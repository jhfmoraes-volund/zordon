"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function DoneStep() {
  return (
    <div className="space-y-6 text-center py-8">
      <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10 text-green-600">
        <CheckCircle2 className="h-7 w-7" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Avaliação salva</h1>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Seu card de skills agora é visível pros outros membros em /membros.
          Volte aqui sempre que quiser atualizar.
        </p>
      </div>
      <div className="flex justify-center gap-3">
        <Link href="/profile">
          <Button>Ir pro meu perfil</Button>
        </Link>
        <Link href="/members">
          <Button variant="outline">Ver time</Button>
        </Link>
      </div>
    </div>
  );
}
