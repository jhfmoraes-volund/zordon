import { getProjectOverviews } from "@/lib/dal/project-overview";
import { computeMetric, createMetricCtx } from "@/lib/metrics/compute";
import { listMetricDefs } from "@/lib/metrics/registry";
import { ProjetosBoard, type RegistryUi } from "./projetos-board";

/** Server component — busca a inteligência por projeto e delega o render. */
export async function ProjetosView() {
  const ctx = createMetricCtx();
  const [projects, factoryLoad] = await Promise.all([
    getProjectOverviews(),
    computeMetric(ctx, "factory.committed_vs_capacity"),
  ]);
  // D6: name/defense/thresholds do registry são o vocabulário da UI. Só
  // strings/JSON cruzam a fronteira server→client — o registry (compute)
  // nunca entra no bundle.
  const defs = listMetricDefs();
  const registryUi: RegistryUi = {
    names: Object.fromEntries(defs.map((d) => [d.id, d.name])),
    defenses: Object.fromEntries(defs.map((d) => [d.id, d.defense])),
    bands: Object.fromEntries(
      defs.filter((d) => d.thresholds?.length).map((d) => [d.id, d.thresholds!]),
    ),
  };
  return (
    <ProjetosBoard projects={projects} factoryLoad={factoryLoad} registryUi={registryUi} />
  );
}
