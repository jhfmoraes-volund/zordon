import { list } from "@/lib/dal/open-source";
import { OpenSourceGallery } from "@/components/open-source/open-source-gallery";

export const dynamic = "force-dynamic";

export default async function OpenSourceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cards = await list();
  return <OpenSourceGallery initial={cards} selectedId={id} />;
}
