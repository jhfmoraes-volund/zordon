export type Squad = {
  id: string;
  name: string;
  projectSquads: { id: string; project: { id: string; name: string } }[];
  members: {
    id: string;
    member: { id: string; name: string; role: string; position: string | null };
  }[];
};

export type Project = { id: string; name: string };

export type Member = {
  id: string;
  name: string;
  role: string;
  position: string | null;
};

/** Map Supabase row shape (PascalCase join tables) to the Squad type used by the UI. */
export function mapSquadRow(row: Record<string, unknown>): Squad {
  const projectSquads = (
    (row.ProjectSquad as Array<Record<string, unknown>> | undefined) ?? []
  ).map((ps) => ({
    id: ps.id as string,
    project: ps.project as { id: string; name: string },
  }));

  const members = (
    (row.SquadMember as Array<Record<string, unknown>> | undefined) ?? []
  ).map((sm) => ({
    id: sm.id as string,
    member: sm.member as {
      id: string;
      name: string;
      role: string;
      position: string | null;
    },
  }));

  return {
    id: row.id as string,
    name: row.name as string,
    projectSquads,
    members,
  };
}
