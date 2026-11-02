import { env } from "../config/env.js";
import type { PaymentProvider, ProviderName } from "./PaymentProvider.js";
import { cashfreeProvider } from "./providers/cashfree.js";
import { mockProvider } from "./providers/mock.js";

let instance: PaymentProvider | null = null;

/** Factory selected by PAYMENT_PROVIDER (default mock). Cashfree config is validated only when selected. */
export function getPaymentProvider(): PaymentProvider {
  if (instance) return instance;
  if (env.PAYMENT_PROVIDER === "cashfree") {
    if (!env.CASHFREE_APP_ID || !env.CASHFREE_SECRET_KEY) {
      throw new Error(
        "PAYMENT_PROVIDER=cashfree requires CASHFREE_APP_ID and CASHFREE_SECRET_KEY",
      );
    }
    instance = cashfreeProvider({
      appId: env.CASHFREE_APP_ID,
      secretKey: env.CASHFREE_SECRET_KEY,
      webhookSecret: env.CASHFREE_WEBHOOK_SECRET,
      env: env.CASHFREE_ENV,
      apiVersion: env.CASHFREE_API_VERSION,
    });
  } else {
    instance = mockProvider();
  }
  return instance;
}

/** Tests swap providers. */
export function setPaymentProvider(p: PaymentProvider | null) {
  instance = p;
}

export const isProviderName = (v: string): v is ProviderName =>
  v === "mock" || v === "cashfree";
