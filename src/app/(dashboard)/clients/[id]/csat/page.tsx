import { redirect } from "next/navigation";

/**
 * CSAT virou o app "Satisfação" no dock de Apps do cliente.
 * Preserva deep-links antigos redirecionando pro launcher com ?app=csat.
 */
export default async function CsatRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/clients/${id}/apps?app=csat`);
}
