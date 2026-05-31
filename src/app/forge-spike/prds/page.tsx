"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

// Legacy spike route — kanban canônico vive em /projects/[id]/forge/kanban.
// Mantido como redirect pra preservar deep-links antigos.
export default function LegacyPrdsKanbanRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId");

  useEffect(() => {
    if (projectId) {
      router.replace(`/projects/${projectId}/forge/kanban`);
    }
  }, [projectId, router]);

  if (!projectId) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", color: "#888" }}>
        Esta rota foi movida pra <code>/projects/[id]/forge/kanban</code>.
        Acesse via o tab Forge do projeto.{" "}
        <Link href="/" style={{ color: "#60a5fa" }}>
          ← home
        </Link>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", color: "#888" }}>
      Redirecionando…
    </div>
  );
}
