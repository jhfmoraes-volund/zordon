import { createClient } from "@/lib/supabase/server";
import {
  SquadsTable,
  mapSquadRow,
  type Squad,
  type Project,
  type Member,
} from "@/components/squads/squads-table";

export const dynamic = "force-dynamic";

export default async function SquadsPage() {
  const supabase = await createClient();

  const [squadsRes, projectsRes, membersRes] = await Promise.all([
    supabase
      .from("Squad")
      .select(
        "*, SquadMember(*, member:Member(*)), ProjectSquad(*, project:Project(id, name))",
      )
      .order("name"),
    supabase.from("Project").select("id, name").order("name"),
    supabase
      .from("Member")
      .select("id, name, role, position")
      .eq("isGuest", false)
      .order("name"),
  ]);

  return (
    <SquadsTable
      initialSquads={(squadsRes.data ?? []).map(mapSquadRow) as Squad[]}
      initialProjects={(projectsRes.data ?? []) as Project[]}
      initialMembers={(membersRes.data ?? []) as Member[]}
    />
  );
}
