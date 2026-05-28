import { DeepSubject } from "subjecto";
import { INITIAL_ORG_SETTINGS_STATE, type OrgSettingsState } from "../types/org-settings";

export const $orgSettings = new DeepSubject<OrgSettingsState>(INITIAL_ORG_SETTINGS_STATE);
