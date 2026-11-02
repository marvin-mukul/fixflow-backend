import type { Request, Response } from "express";
import { currentUser, validated } from "../lib/http.js";
import type {
  InviteInput,
  PropertyInput,
  PropertyPatch,
} from "../schemas/property.schema.js";
import { propertyService } from "../services/property.service.js";

type Id = { id: string };

export const propertyController = {
  async list(req: Request, res: Response) {
    res.json(await propertyService.list(currentUser(req).id));
  },
  async create(req: Request, res: Response) {
    const { body } = validated<{ body: PropertyInput }>(res);
    res
      .status(201)
      .json(await propertyService.create(currentUser(req).id, body));
  },
  async get(req: Request, res: Response) {
    const { params } = validated<{ params: Id }>(res);
    res.json(await propertyService.get(params.id, currentUser(req).id));
  },
  async update(req: Request, res: Response) {
    const { params, body } = validated<{ params: Id; body: PropertyPatch }>(
      res,
    );
    res.json(
      await propertyService.update(params.id, currentUser(req).id, body),
    );
  },
  async remove(req: Request, res: Response) {
    const { params } = validated<{ params: Id }>(res);
    await propertyService.remove(params.id, currentUser(req).id);
    res.status(204).end();
  },
  async invite(req: Request, res: Response) {
    const { params, body } = validated<{ params: Id; body: InviteInput }>(res);
    res
      .status(201)
      .json(await propertyService.invite(params.id, currentUser(req).id, body));
  },
  async previewInvitation(_req: Request, res: Response) {
    const { params } = validated<{ params: { token: string } }>(res);
    res.json(await propertyService.previewInvitation(params.token));
  },
  async acceptInvitation(req: Request, res: Response) {
    const { params } = validated<{ params: { token: string } }>(res);
    res.json(
      await propertyService.acceptInvitation(params.token, currentUser(req)),
    );
  },
  async endTenancy(req: Request, res: Response) {
    const { params } = validated<{ params: { id: string; tid: string } }>(res);
    await propertyService.endTenancy(
      params.id,
      params.tid,
      currentUser(req).id,
    );
    res.status(204).end();
  },
};
