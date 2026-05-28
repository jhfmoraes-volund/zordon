import { redirect } from "next/navigation";
import { loadCapacityPayload } from "@/lib/profile/capacity-load";
import { CapacityView, type CapacityPayload } from "@/components/profile/capacity-view";

export const dynamic = "force-dynamic";

export default async function ProfileCapacityPage() {
  const result = await loadCapacityPayload();
  if (result === null) redirect("/login");
  if (result === "guest") {
    return (
      <p className="p-6 text-sm text-red-600">Sem permissão para ver capacity.</p>
    );
  }
  return <CapacityView data={result.payload as CapacityPayload} />;
}
