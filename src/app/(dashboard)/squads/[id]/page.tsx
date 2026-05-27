import { requireMinLevel } from "@/lib/dal";
import { BUILDER } from "@/lib/roles";
import { SquadLounge } from "@/components/squad/squad-lounge";

export const dynamic = "force-dynamic";

export default async function SquadLoungePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMinLevel(BUILDER);
  const { id } = await params;
  return <SquadLounge squadId={id} />;
}
