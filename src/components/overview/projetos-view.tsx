import { getProjectOverviews, getFactoryStats } from "@/lib/dal/project-overview";
import { listMetricDefs } from "@/lib/metrics/registry";
import { ProjetosBoard } from "./projetos-board";

/** Server component — busca a inteligência por projeto e delega o render. */
export async function ProjetosView() {
  const [projects, factory] = await Promise.all([getProjectOverviews(), getFactoryStats()]);
  // D6: a `defense` do registry é o tooltip da UI. Só as strings cruzam a
  // fronteira server→client — o registry (compute) nunca entra no bundle.
  const defenses = Object.fromEntries(
    listMetricDefs("project").map((d) => [d.id, d.defense]),
  );
  return <ProjetosBoard projects={projects} factory={factory} defenses={defenses} />;
}
