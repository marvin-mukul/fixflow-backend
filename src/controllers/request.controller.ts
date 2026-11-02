import type { Request, Response } from "express";
import { currentUser, validated } from "../lib/http.js";
import { uploadedFiles } from "../middlewares/upload.js";
import type {
  CreateRequestInput,
  ListRequestsInput,
} from "../schemas/request.schema.js";
import { requestService } from "../services/request.service.js";

type Id = { id: string };

export const requestController = {
  async create(req: Request, res: Response) {
    const { body } = validated<{ body: CreateRequestInput }>(res);
    res.status(201).json(await requestService.create(currentUser(req), body));
  },
  async list(req: Request, res: Response) {
    const { query } = validated<{ query: ListRequestsInput }>(res);
    res.json(await requestService.list(currentUser(req), query));
  },
  async get(req: Request, res: Response) {
    const { params } = validated<{ params: Id }>(res);
    res.json(await requestService.get(params.id, currentUser(req)));
  },
  async approve(req: Request, res: Response) {
    const { params, body } = validated<{
      params: Id;
      body: { tenantPays: boolean };
    }>(res);
    res.json(
      await requestService.approve(
        params.id,
        currentUser(req),
        body.tenantPays,
      ),
    );
  },
  async reject(req: Request, res: Response) {
    const { params, body } = validated<{
      params: Id;
      body: { reason: string };
    }>(res);
    res.json(
      await requestService.reject(params.id, currentUser(req), body.reason),
    );
  },
  async cancel(req: Request, res: Response) {
    const { params, body } = validated<{
      params: Id;
      body: { reason: string };
    }>(res);
    res.json(
      await requestService.cancel(params.id, currentUser(req), body.reason),
    );
  },
  async reopen(req: Request, res: Response) {
    const { params } = validated<{ params: Id }>(res);
    res.json(await requestService.reopen(params.id, currentUser(req)));
  },
  async timeline(req: Request, res: Response) {
    const { params } = validated<{ params: Id }>(res);
    res.json(await requestService.timeline(params.id, currentUser(req)));
  },
  async uploadMedia(req: Request, res: Response) {
    const { params } = validated<{ params: Id }>(res);
    res
      .status(201)
      .json(
        await requestService.uploadMedia(
          params.id,
          currentUser(req),
          uploadedFiles(req),
        ),
      );
  },
  async media(req: Request, res: Response) {
    const { params } = validated<{ params: { id: string; mediaId: string } }>(
      res,
    );
    const file = await requestService.openMedia(
      params.id,
      params.mediaId,
      currentUser(req),
    );
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", String(file.size));
    res.setHeader("Cache-Control", "private, max-age=300");
    file.stream.pipe(res);
  },
};
