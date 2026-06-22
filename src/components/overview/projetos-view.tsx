import { getProjectOverviews } from "@/lib/dal/project-overview";
import { getBuilderCommitments } from "@/lib/dal/capacity";
import { computeMetric, createMetricCtx } from "@/lib/metrics/compute";
import { listMetricDefs } from "@/lib/metrics/registry";
import { ProjetosBoard, type RegistryUi } from "./projetos-board";

/**
 * Server component — busca a inteligência por projeto e delega o render.
 *
 * @param clientId  Escopa o board aos projetos do cliente (aba Projetos da
 *   página de cliente). Sem ele, o universo é a fábrica inteira (Overview org).
 * @param hideRibbon  Esconde a ribbon de KPIs fábrica-wide (D2). Quando true,
 *   PULA os fetches que só a alimentam (factoryLoad/builderLoads) — não basta
 *   esconder a UI, a query fábrica-wide não roda na página de cliente.
 */
export async function ProjetosView({
  clientId,
  hideRibbon = false,
}: {
  clientId?: string;
  hideRibbon?: boolean;
} = {}) {
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

  if (hideRibbon) {
    // Board scoped: só os projetos do cliente. A ribbon (e seus fetches
    // fábrica-wide) não existem aqui.
    const projects = await getProjectOverviews(clientId);
    return (
      <ProjetosBoard projects={projects} registryUi={registryUi} hideRibbon />
    );
  }

  const ctx = createMetricCtx();
  const [projects, factoryLoad, builderLoads] = await Promise.all([
    getProjectOverviews(clientId),
    computeMetric(ctx, "factory.committed_vs_capacity"),
    getBuilderCommitments(),
  ]);
  return (
    <ProjetosBoard
      projects={projects}
      factoryLoad={factoryLoad}
      builderLoads={builderLoads}
      registryUi={registryUi}
    />
  );
}
