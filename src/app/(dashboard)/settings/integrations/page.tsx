import { RoamIntegrationCard, GranolaIntegrationCard } from "../integrations-card";
import { GitHubIntegrationCard, GoogleDriveIntegrationCard } from "../composio-card";
import { TelegramCard } from "@/components/settings/telegram-card";

export default function IntegrationsSettingsPage() {
  return (
    <div className="space-y-4">
      <RoamIntegrationCard />
      <GranolaIntegrationCard />
      <GitHubIntegrationCard />
      <GoogleDriveIntegrationCard />
      <TelegramCard />
    </div>
  );
}
