import { mergeSettings, type Settings } from "../domain/settings.js";
import { settingsRepository } from "../repositories/settings.repository.js";

const TTL_MS = 30_000;
let cache: { value: Settings; at: number } | null = null;

export const settingsService = {
  /** Cached for 30 s; `invalidate()` on write. */
  async getSettings(): Promise<Settings> {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
    const value = mergeSettings(await settingsRepository.findAll());
    cache = { value, at: Date.now() };
    return value;
  },

  invalidate() {
    cache = null;
  },
};
