import { percentOf } from "./money.js";

/** requirements.md §6. Pure — all amounts integer paise, half-up per line. */
export type PricingSettings = {
  commissionPercent: number;
  gstPercent: number;
  tcsPercent: number;
  gstOnCommission: boolean;
};

export type InvoiceBreakdown = {
  servicePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  commissionPaise: number;
  commissionGstPaise: number;
  tcsPaise: number;
  workerPayoutPaise: number;
  gstMode: "PLATFORM_9_5" | "WORKER_REGISTERED";
  ratesSnapshot: {
    commissionPercent: number;
    gstPercent: number;
    tcsPercent: number;
    gstOnCommission: boolean;
    intraState: boolean;
    workerState: string;
    propertyState: string;
  };
};

const norm = (s: string) => s.trim().toLowerCase();

export function computeInvoice(
  quote: { servicePaise: number },
  worker: { gstin: string | null; state: string },
  property: { state: string },
  s: PricingSettings,
): InvoiceBreakdown {
  const service = quote.servicePaise;
  const intraState = norm(worker.state) === norm(property.state);

  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (intraState) {
    cgst = percentOf(service, s.gstPercent / 2);
    sgst = percentOf(service, s.gstPercent / 2);
  } else {
    igst = percentOf(service, s.gstPercent);
  }
  const gst = cgst + sgst + igst;
  const total = service + gst;

  const commission = percentOf(service, s.commissionPercent);
  const commissionGst = s.gstOnCommission
    ? percentOf(commission, s.gstPercent)
    : 0;
  const registered = Boolean(worker.gstin);

  // Unregistered worker: platform is the deemed supplier (CGST s.9(5)) and keeps the GST to remit.
  // Registered worker: worker remits GST (it is part of their payout); platform collects TCS (s.52).
  const tcs = registered ? percentOf(service, s.tcsPercent) : 0;
  const payout = registered
    ? total - commission - commissionGst - tcs
    : service - commission - commissionGst;

  return {
    servicePaise: service,
    cgstPaise: cgst,
    sgstPaise: sgst,
    igstPaise: igst,
    totalPaise: total,
    commissionPaise: commission,
    commissionGstPaise: commissionGst,
    tcsPaise: tcs,
    workerPayoutPaise: payout,
    gstMode: registered ? "WORKER_REGISTERED" : "PLATFORM_9_5",
    ratesSnapshot: {
      commissionPercent: s.commissionPercent,
      gstPercent: s.gstPercent,
      tcsPercent: s.tcsPercent,
      gstOnCommission: s.gstOnCommission,
      intraState,
      workerState: worker.state,
      propertyState: property.state,
    },
  };
}
