"use client";

import { use } from "react";
import { PMReviewWorkspace } from "@/components/pm-review/pm-review-workspace";

/**
 * Rota legada de uma PM Review específica. Mantida como wrapper fino do
 * `PMReviewWorkspace` (standalone, com título). Vira redirect server-side pra
 * `/projects/[id]/pm-review?week=…` quando a app única estabilizar (ver runbook
 * pm-review-unified-app, D9/OQ1).
 */
export default function PMReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <div className="-mx-3 -my-4 flex h-[calc(100svh-3rem)] flex-col overflow-hidden sm:-mx-4 md:h-[calc(100svh-3.5rem)] lg:-m-6">
      <PMReviewWorkspace pmReviewId={id} withTitle />
    </div>
  );
}
