import { redirect } from "next/navigation";
import { loadPdiPayload } from "@/lib/profile/pdi-load";
import { PdiView, type PdiViewPayload } from "@/components/profile/pdi-view";

export const dynamic = "force-dynamic";

export default async function PdiPage() {
  const payload = await loadPdiPayload();
  if (!payload) redirect("/login");
  return <PdiView initial={payload as PdiViewPayload} />;
}
