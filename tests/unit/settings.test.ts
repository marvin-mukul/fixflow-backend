import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  SettingsSchema,
} from "../../src/domain/settings.js";

describe("settings", () => {
  it("defaults are valid", () => {
    expect(SettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
  it("stored values override, invalid ones fall back", () => {
    const s = mergeSettings({ commissionPercent: 12, fanoutLimit: "lots" });
    expect(s.commissionPercent).toBe(12);
    expect(s.fanoutLimit).toBe(15);
  });
});
