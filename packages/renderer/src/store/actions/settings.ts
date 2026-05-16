import { genie, type AppSettings } from "@/lib/genie-api";
import { $settings } from "../subjects/common";

// --- Settings actions ---

export async function loadSettings(): Promise<void> {
  const result = await genie.getSettings();
  $settings.next({
    defaultEditor: result.defaultEditor || "",
    digitaloceanApiToken: result.digitaloceanApiToken || "",
    gitlabDeployKey: result.gitlabDeployKey || "",
    gitToken: result.gitToken || "",
    railwayToken: result.railwayToken || "",
    railwayProjectId: result.railwayProjectId || "",
  });
}

export async function saveSettingsField<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): Promise<void> {
  const s = $settings.getValue();
  const updated = { ...s, [key]: value };
  $settings.next(updated);
  await genie.saveSettings(updated);
}
