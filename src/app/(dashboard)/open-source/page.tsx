import { list } from "@/lib/dal/open-source";
import { OpenSourceGallery } from "@/components/open-source/open-source-gallery";

export const dynamic = "force-dynamic";

export default async function OpenSourcePage() {
  const cards = await list();
  return <OpenSourceGallery initial={cards} />;
}
