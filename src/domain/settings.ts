import { z } from "zod";

/** Platform settings (requirements.md §6). Pure: schema + defaults only. */
export const PrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "EMERGENCY"]);

export const SettingsSchema = z.object({
  commissionPercent: z.number().min(0).max(50),
  gstPercent: z.number().min(0).max(40),
  tcsPercent: z.number().min(0).max(5),
  gstOnCommission: z.boolean(),
  matchRadiusKm: z.number().int().min(1).max(50),
  reopenRadiusKm: z.number().int().min(1).max(100),
  fanoutLimit: z.number().int().min(1).max(100),
  newcomerSlots: z.number().int().min(0).max(10),
  quoteWindowHours: z.object({
    LOW: z.number().positive(),
    MEDIUM: z.number().positive(),
    HIGH: z.number().positive(),
    EMERGENCY: z.number().positive(),
  }),
  autoConfirmHours: z.number().positive(),
  reviewWindowDays: z.number().positive(),
  rankingWeights: z.object({
    rating: z.number().min(0).max(1),
    distance: z.number().min(0).max(1),
    completion: z.number().min(0).max(1),
    response: z.number().min(0).max(1),
  }),
  bayesianC: z.number().positive(),
  bayesianPriorMean: z.number().min(1).max(5),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
  commissionPercent: 10,
  gstPercent: 18,
  tcsPercent: 0.5,
  gstOnCommission: true,
  matchRadiusKm: 20,
  reopenRadiusKm: 30,
  fanoutLimit: 15,
  newcomerSlots: 2,
  quoteWindowHours: { LOW: 24, MEDIUM: 24, HIGH: 6, EMERGENCY: 1 },
  autoConfirmHours: 72,
  reviewWindowDays: 7,
  rankingWeights: {
    rating: 0.55,
    distance: 0.2,
    completion: 0.15,
    response: 0.1,
  },
  bayesianC: 10,
  bayesianPriorMean: 4,
};

/** Merges stored rows over defaults; unknown/invalid stored values fall back to defaults. */
export function mergeSettings(stored: Record<string, unknown>): Settings {
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) {
    if (!(key in stored)) continue;
    const field = SettingsSchema.shape[key].safeParse(stored[key]);
    if (field.success) merged[key] = field.data;
  }
  return merged as Settings;
}
