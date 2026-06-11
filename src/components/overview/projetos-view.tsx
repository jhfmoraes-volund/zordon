import { getProjectOverviews } from "@/lib/dal/project-overview";
import { getBuilderAllocation } from "@/lib/dal/capacity";
import { getMetricDef, listMetricDefs } from "@/lib/metrics/registry";
import { ProjetosBoard, type RegistryUi } from "./projetos-board";

/** Server component — busca a inteligência por projeto e delega o render. */
export async function ProjetosView() {
  const [projects, buildersAllocated] = await Promise.all([
    getProjectOverviews(),
    getBuilderAllocation(),
  ]);
  // D6: name/defense do registry são o vocabulário da UI. Só strings cruzam a
  // fronteira server→client — o registry (compute) nunca entra no bundle.
  const defs = listMetricDefs();
  const registryUi: RegistryUi = {
    names: Object.fromEntries(defs.map((d) => [d.id, d.name])),
    defenses: Object.fromEntries(defs.map((d) => [d.id, d.defense])),
    paceBands: getMetricDef("project.pace_gap")?.thresholds ?? [],
  };
  return (
    <ProjetosBoard
      projects={projects}
      buildersAllocated={buildersAllocated}
      registryUi={registryUi}
    />
  );
}
