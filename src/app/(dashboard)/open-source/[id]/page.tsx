import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getById } from "@/lib/dal/open-source";
import { OpenSourceCard } from "@/components/open-source/open-source-card";
import { OpenSourceDetailActions } from "@/components/open-source/open-source-detail-actions";

export const dynamic = "force-dynamic";

export default async function OpenSourceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const card = await getById(id);
  if (!card) notFound();

  return (
    <div className="space-y-4">
      <div className="mx-auto flex max-w-[860px] items-center justify-between">
        <Link
          href="/open-source"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Open Source
        </Link>
        <OpenSourceDetailActions card={card} />
      </div>
      <OpenSourceCard card={card} />
    </div>
  );
}
