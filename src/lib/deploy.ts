// TODO: re-enable when GitHub integration is active
// import { github } from "@/lib/github";

export const deployOrchestrator = {
  async mergeSprintToStaging(_sprintId: string, _triggeredBy?: string) {
    throw new Error("GitHub integration is disabled — deploy not available");
  },

  async promoteToProduction(_sprintId: string, _triggeredBy?: string) {
    throw new Error("GitHub integration is disabled — deploy not available");
  },
};
