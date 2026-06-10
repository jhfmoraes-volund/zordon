import { getProjectOverviews, getFactoryStats } from "@/lib/dal/project-overview";
import { ProjetosBoard } from "./projetos-board";

/** Server component — busca a inteligência por projeto e delega o render. */
export async function ProjetosView() {
  const [projects, factory] = await Promise.all([getProjectOverviews(), getFactoryStats()]);
  return <ProjetosBoard projects={projects} factory={factory} />;
}
