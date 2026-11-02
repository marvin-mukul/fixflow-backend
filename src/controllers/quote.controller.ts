import type { Request, Response } from "express";
import { currentUser, validated } from "../lib/http.js";
import type {
  CreateQuoteInput,
  ReviseQuoteInput,
} from "../schemas/quote.schema.js";
import { quoteService } from "../services/quote.service.js";

type Id = { id: string };

export const quoteController = {
  async create(req: Request, res: Response) {
    const { params, body } = validated<{ params: Id; body: CreateQuoteInput }>(
      res,
    );
    res
      .status(201)
      .json(await quoteService.create(params.id, currentUser(req).id, body));
  },
  async list(req: Request, res: Response) {
    const { params } = validated<{ params: Id }>(res);
    res.json(await quoteService.listForRequest(params.id, currentUser(req)));
  },
  async revise(req: Request, res: Response) {
    const { params, body } = validated<{ params: Id; body: ReviseQuoteInput }>(
      res,
    );
    res.json(await quoteService.revise(params.id, currentUser(req).id, body));
  },
  async withdraw(req: Request, res: Response) {
    const { params } = validated<{ params: Id }>(res);
    res.json(await quoteService.withdraw(params.id, currentUser(req).id));
  },
  async accept(req: Request, res: Response) {
    const { params, body } = validated<{
      params: Id;
      body: { version: number };
    }>(res);
    res
      .status(201)
      .json(
        await quoteService.accept(params.id, currentUser(req), body.version),
      );
  },
};
