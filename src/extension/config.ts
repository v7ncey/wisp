/** The deployed Wisp server. Must match host_permissions in extension/manifest.json. */
export const API_URL = "https://wisp-coach.vercel.app/api/coach";
export const SETTINGS_KEY = "wisp-settings";
export interface Settings {
  /** Off by default: nothing leaves the browser unless the user turns this on. */
  personalize: boolean;
}
export const DEFAULT_SETTINGS: Settings = { personalize: false };
