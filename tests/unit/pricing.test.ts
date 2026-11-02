import { describe, expect, it } from "vitest";
import {
  applyBps,
  financialYear,
  invoiceNumber,
  paiseToRupeeString,
  toBps,
} from "../../src/domain/money.js";
import { computeInvoice } from "../../src/domain/pricing.js";
import { DEFAULT_SETTINGS } from "../../src/domain/settings.js";
import {
  nextSubStatus,
  workerActions,
} from "../../src/domain/jobStateMachine.js";

const s = DEFAULT_SETTINGS;
const UK = { state: "Uttarakhand" };

describe("money", () => {
  it("half-up rounding in basis points", () => {
    expect(toBps(0.5)).toBe(50);
    expect(applyBps(1, 5000)).toBe(1); // 0.5 → 1
    expect(applyBps(3, 5000)).toBe(2); // 1.5 → 2
    expect(applyBps(10001, 900)).toBe(900); // 900.09 → 900
    expect(applyBps(10006, 900)).toBe(901); // 900.54 → 901
    expect(() => applyBps(1.5, 100)).toThrow();
  });
  it("formats and numbers invoices", () => {
    expect(paiseToRupeeString(59000)).toBe("590.00");
    expect(paiseToRupeeString(5)).toBe("0.05");
    expect(financialYear(new Date("2026-11-02T00:00:00Z"))).toBe("2026-27");
    expect(financialYear(new Date("2027-03-31T00:00:00Z"))).toBe("2026-27");
    expect(financialYear(new Date("2027-04-01T00:00:00Z"))).toBe("2027-28");
    expect(invoiceNumber("2026-27", 42)).toBe("FF/2026-27/000042");
  });
});

describe("computeInvoice", () => {
  it("₹500 reference, unregistered intra-state: customer ₹590, commission ₹50, GST on commission ₹9, payout ₹441", () => {
    const inv = computeInvoice(
      { servicePaise: 50000 },
      { gstin: null, ...UK },
      UK,
      s,
    );
    expect(inv).toMatchObject({
      servicePaise: 50000,
      cgstPaise: 4500,
      sgstPaise: 4500,
      igstPaise: 0,
      totalPaise: 59000,
      commissionPaise: 5000,
      commissionGstPaise: 900,
      tcsPaise: 0,
      workerPayoutPaise: 44100,
      gstMode: "PLATFORM_9_5",
    });
    expect(inv.ratesSnapshot.intraState).toBe(true);
  });

  it("inter-state uses IGST", () => {
    const inv = computeInvoice(
      { servicePaise: 50000 },
      { gstin: null, state: "Delhi" },
      UK,
      s,
    );
    expect(inv).toMatchObject({
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 9000,
      totalPaise: 59000,
    });
  });

  it("registered worker: GST in payout, TCS 0.5%", () => {
    const inv = computeInvoice(
      { servicePaise: 50000 },
      { gstin: "05ABCDE1234F1Z5", ...UK },
      UK,
      s,
    );
    expect(inv.gstMode).toBe("WORKER_REGISTERED");
    expect(inv.tcsPaise).toBe(250);
    expect(inv.workerPayoutPaise).toBe(59000 - 5000 - 900 - 250);
  });

  it("gstOnCommission off; odd amounts round per line", () => {
    const inv = computeInvoice(
      { servicePaise: 33333 },
      { gstin: null, ...UK },
      UK,
      { ...s, gstOnCommission: false },
    );
    expect(inv.cgstPaise).toBe(3000); // 2999.97 → 3000
    expect(inv.sgstPaise).toBe(3000);
    expect(inv.totalPaise).toBe(39333);
    expect(inv.commissionPaise).toBe(3333); // 3333.3 → 3333
    expect(inv.commissionGstPaise).toBe(0);
    expect(inv.workerPayoutPaise).toBe(30000);
  });

  it("state comparison is case/space-insensitive and snapshot records rates", () => {
    const inv = computeInvoice(
      { servicePaise: 100 },
      { gstin: null, state: " uttarakhand " },
      UK,
      { ...s, commissionPercent: 12 },
    );
    expect(inv.ratesSnapshot).toMatchObject({
      intraState: true,
      commissionPercent: 12,
      gstPercent: 18,
    });
  });
});

describe("job sub-status", () => {
  it("enforces order", () => {
    expect(nextSubStatus("CONFIRMED", "en_route")).toBe("EN_ROUTE");
    expect(nextSubStatus("EN_ROUTE", "arrive")).toBe("ARRIVED");
    expect(nextSubStatus("ARRIVED", "start")).toBe("WORKING");
    expect(nextSubStatus("WORKING", "complete")).toBe("DONE");
    expect(nextSubStatus("CONFIRMED", "arrive")).toBeNull();
    expect(nextSubStatus("CONFIRMED", "complete")).toBeNull();
    expect(workerActions("ARRIVED")).toEqual(["start"]);
    expect(workerActions("DONE")).toEqual([]);
  });
});
