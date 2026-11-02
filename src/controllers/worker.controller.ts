import type { Request, Response } from "express";
import { currentUser, validated } from "../lib/http.js";
import { uploadedFiles } from "../middlewares/upload.js";
import type { WorkerProfileInput } from "../schemas/worker.schema.js";
import { quoteService } from "../services/quote.service.js";
import { workerService } from "../services/worker.service.js";

export const workerController = {
  async getProfile(req: Request, res: Response) {
    res.json(await workerService.getProfile(currentUser(req).id));
  },
  async putProfile(req: Request, res: Response) {
    const { body } = validated<{ body: WorkerProfileInput }>(res);
    res.json(await workerService.upsertProfile(currentUser(req).id, body));
  },
  async putCategories(req: Request, res: Response) {
    const { body } = validated<{
      body: { categories: { categoryId: string; yearsExperience: number }[] };
    }>(res);
    res.json(
      await workerService.setCategories(currentUser(req).id, body.categories),
    );
  },
  async availability(req: Request, res: Response) {
    const { body } = validated<{ body: { isAvailable: boolean } }>(res);
    res.json(
      await workerService.setAvailability(
        currentUser(req).id,
        body.isAvailable,
      ),
    );
  },
  async idDocument(req: Request, res: Response) {
    res
      .status(201)
      .json(
        await workerService.uploadIdDocument(
          currentUser(req).id,
          uploadedFiles(req),
        ),
      );
  },
  async leads(req: Request, res: Response) {
    const { query } = validated<{
      query: { open: boolean; cursor?: string; limit: number };
    }>(res);
    res.json(await workerService.leads(currentUser(req).id, query));
  },
  async lead(req: Request, res: Response) {
    const { params } = validated<{ params: { requestId: string } }>(res);
    res.json(await workerService.lead(currentUser(req).id, params.requestId));
  },
  async myQuotes(req: Request, res: Response) {
    res.json(await quoteService.mine(currentUser(req).id));
  },
  async publicProfile(_req: Request, res: Response) {
    const { params } = validated<{ params: { id: string } }>(res);
    res.json(await workerService.publicProfile(params.id));
  },
};
