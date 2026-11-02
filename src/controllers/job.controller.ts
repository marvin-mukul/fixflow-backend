import type { Request, Response } from "express";
import { currentUser, validated } from "../lib/http.js";
import { uploadedFiles } from "../middlewares/upload.js";
import type { ReviewInput, ReviewPatch } from "../schemas/review.schema.js";
import { invoiceService } from "../services/invoice.service.js";
import { jobService } from "../services/job.service.js";
import { reviewService } from "../services/review.service.js";

type Id = { id: string };
const id = (res: Response) => validated<{ params: Id }>(res).params.id;

export const jobController = {
  async list(req: Request, res: Response) {
    const { query } = validated<{
      query: { active: boolean; cursor?: string; limit: number };
    }>(res);
    res.json(await jobService.list(currentUser(req), query));
  },
  async get(req: Request, res: Response) {
    res.json(await jobService.get(id(res), currentUser(req)));
  },
  async enRoute(req: Request, res: Response) {
    res.json(await jobService.step(id(res), currentUser(req), "en_route"));
  },
  async arrive(req: Request, res: Response) {
    res.json(await jobService.step(id(res), currentUser(req), "arrive"));
  },
  async start(req: Request, res: Response) {
    res.json(await jobService.start(id(res), currentUser(req)));
  },
  async complete(req: Request, res: Response) {
    const { params, body } = validated<{
      params: Id;
      body: { finalAmountPaise?: number };
    }>(res);
    res.json(
      await jobService.complete(
        params.id,
        currentUser(req),
        uploadedFiles(req),
        body.finalAmountPaise,
      ),
    );
  },
  async confirm(req: Request, res: Response) {
    res.json(await jobService.confirm(id(res), currentUser(req)));
  },
  async dispute(req: Request, res: Response) {
    const { params, body } = validated<{
      params: Id;
      body: { reason: string };
    }>(res);
    res.json(
      await jobService.dispute(params.id, currentUser(req), body.reason),
    );
  },
  async invoiceForJob(req: Request, res: Response) {
    res.json(await invoiceService.getByJob(id(res), currentUser(req)));
  },
  async invoice(req: Request, res: Response) {
    res.json(await invoiceService.get(id(res), currentUser(req)));
  },
  async earnings(req: Request, res: Response) {
    res.json(await invoiceService.earnings(currentUser(req).id));
  },
  async createReview(req: Request, res: Response) {
    const { params, body } = validated<{ params: Id; body: ReviewInput }>(res);
    res
      .status(201)
      .json(await reviewService.create(params.id, currentUser(req), body));
  },
  async updateReview(req: Request, res: Response) {
    const { params, body } = validated<{ params: Id; body: ReviewPatch }>(res);
    res.json(await reviewService.update(params.id, currentUser(req), body));
  },
  async workerReviews(_req: Request, res: Response) {
    const { params, query } = validated<{
      params: Id;
      query: { cursor?: string; limit: number };
    }>(res);
    res.json(await reviewService.listForWorker(params.id, query));
  },
  async listDisputes(_req: Request, res: Response) {
    const { query } = validated<{ query: { status?: "OPEN" | "RESOLVED" } }>(
      res,
    );
    res.json(await jobService.listDisputes(query.status));
  },
  async resolveDispute(req: Request, res: Response) {
    const { params, body } = validated<{
      params: Id;
      body: { outcome: "COMPLETE" | "CANCEL"; resolution: string };
    }>(res);
    res.json(
      await jobService.resolveDispute(
        params.id,
        currentUser(req),
        body.outcome,
        body.resolution,
      ),
    );
  },
};
