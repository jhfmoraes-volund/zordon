import { getProjectOverviews } from "@/lib/dal/project-overview";
import { ProjetosBoard } from "./projetos-board";

/** Server component — busca a inteligência por projeto e delega o render. */
export async function ProjetosView() {
  const projects = await getProjectOverviews();
  return <ProjetosBoard projects={projects} />;
}
