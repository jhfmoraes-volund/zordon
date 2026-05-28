import { createClient } from "@/lib/supabase/server";
import { loadMembersList } from "@/lib/members/members-load";
import { MembersView } from "@/components/members/members-view";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const supabase = await createClient();
  const initial = await loadMembersList(supabase);
  return <MembersView initial={initial} />;
}
