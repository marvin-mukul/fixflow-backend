import type { Request, Response } from "express";
import { currentUser, validated } from "../lib/http.js";
import { paymentService } from "../services/payment.service.js";

type Id = { id: string };

export const paymentController = {
  async checkout(req: Request, res: Response) {
    const { params } = validated<{ params: Id }>(res);
    res
      .status(201)
      .json(await paymentService.createCheckout(params.id, currentUser(req)));
  },
  async return(_req: Request, res: Response) {
    const { query } = validated<{ query: Record<string, string> }>(res);
    res.redirect(302, await paymentService.handleReturn(query));
  },
  async webhook(req: Request, res: Response) {
    const { params } = validated<{ params: { provider: string } }>(res);
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [
        k.toLowerCase(),
        Array.isArray(v) ? (v[0] ?? "") : (v ?? ""),
      ]),
    );
    res.json(await paymentService.handleWebhook(params.provider, raw, headers));
  },
  async mockOrder(req: Request, res: Response) {
    const { params } = validated<{ params: { orderId: string } }>(res);
    res.json(await paymentService.mockOrder(params.orderId, currentUser(req)));
  },
  async mockComplete(req: Request, res: Response) {
    const { params, body } = validated<{
      params: { orderId: string };
      body: { outcome: "success" | "failure" };
    }>(res);
    res.json(
      await paymentService.completeMock(
        params.orderId,
        body.outcome,
        currentUser(req),
      ),
    );
  },
  async markOffline(req: Request, res: Response) {
    const { params } = validated<{ params: Id }>(res);
    res.json(await paymentService.markPaidOffline(params.id, currentUser(req)));
  },
  async confirmOffline(req: Request, res: Response) {
    const { params } = validated<{ params: Id }>(res);
    res.json(await paymentService.confirmOffline(params.id, currentUser(req)));
  },
  async refund(req: Request, res: Response) {
    const { params, body } = validated<{
      params: Id;
      body: { amountPaise?: number; reason: string };
    }>(res);
    res.json(await paymentService.refund(params.id, currentUser(req), body));
  },
  async list(_req: Request, res: Response) {
    const { query } = validated<{ query: { status?: string } }>(res);
    res.json(await paymentService.listPayments(query.status));
  },
};
