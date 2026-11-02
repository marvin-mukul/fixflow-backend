import { describe, expect, it } from "vitest";
import {
  approxDistanceKm,
  boundingBox,
  haversineKm,
  maskLocation,
  offsetKm,
  roundCoord,
} from "../../src/domain/geo.js";

const DDN = { lat: 30.3165, lng: 78.0322 };

describe("geo", () => {
  it("haversine: Dehradun → Delhi ≈ 205 km", () => {
    expect(haversineKm(DDN, { lat: 28.6139, lng: 77.209 })).toBeCloseTo(
      205,
      -1,
    );
  });

  it("offsetKm round-trips with haversine", () => {
    expect(haversineKm(DDN, offsetKm(DDN, 10))).toBeCloseTo(10, 1);
    expect(haversineKm(DDN, offsetKm(DDN, 0, 7))).toBeCloseTo(7, 1);
  });

  it("bounding box contains points on the radius", () => {
    const box = boundingBox(DDN, 20);
    for (const p of [offsetKm(DDN, 19.9), offsetKm(DDN, 0, -19.9)]) {
      expect(p.lat).toBeGreaterThanOrEqual(box.minLat);
      expect(p.lat).toBeLessThanOrEqual(box.maxLat);
      expect(p.lng).toBeGreaterThanOrEqual(box.minLng);
      expect(p.lng).toBeLessThanOrEqual(box.maxLng);
    }
  });

  it("rounds coordinates to ~1 km and masks", () => {
    expect(roundCoord(30.31659)).toBe(30.32);
    expect(maskLocation(DDN)).toEqual({ lat: 30.32, lng: 78.03 });
  });

  it("approximate distance rounds to 0.5 km with a 0.5 floor", () => {
    expect(approxDistanceKm(3.26)).toBe(3.5);
    expect(approxDistanceKm(0.1)).toBe(0.5);
  });
});
