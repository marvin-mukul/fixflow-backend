import type { Request, Response } from "express";
import type { Settings } from "../domain/settings.js";
import type { VerificationStatus } from "../generated/prisma/enums.js";
import { currentUser, validated } from "../lib/http.js";
import { adminService } from "../services/admin.service.js";
import { categoryService } from "../services/category.service.js";

type Id = { id: string };

export const adminController = {
  async workers(_req: Request, res: Response) {
    const { query } = validated<{ query: { status?: VerificationStatus } }>(
      res,
    );
    res.json(await adminService.listWorkers(query.status));
  },
  async verify(req: Request, res: Response) {
    const { params } = validated<{ params: Id }>(res);
    res.json(
      await adminService.setWorkerStatus(params.id, currentUser(req), "verify"),
    );
  },
  async reject(req: Request, res: Response) {
    const { params, body } = validated<{
      params: Id;
      body: { reason: string };
    }>(res);
    res.json(
      await adminService.setWorkerStatus(
        params.id,
        currentUser(req),
        "reject",
        body.reason,
      ),
    );
  },
  async suspend(req: Request, res: Response) {
    const { params, body } = validated<{
      params: Id;
      body: { reason: string };
    }>(res);
    res.json(
      await adminService.setWorkerStatus(
        params.id,
        currentUser(req),
        "suspend",
        body.reason,
      ),
    );
  },
  async idDocument(_req: Request, res: Response) {
    const { params } = validated<{ params: Id }>(res);
    const f = await adminService.idDocument(params.id);
    res.setHeader("Content-Type", f.mimeType);
    res.setHeader("Content-Length", String(f.size));
    res.setHeader("Content-Disposition", `inline; filename="${f.filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    f.stream.pipe(res);
  },
  async stats(_req: Request, res: Response) {
    res.json(await adminService.stats());
  },
  async categories(_req: Request, res: Response) {
    res.json(await categoryService.listAll());
  },
  async createCategory(_req: Request, res: Response) {
    const { body } = validated<{
      body: { slug: string; name: string; icon: string };
    }>(res);
    res.status(201).json(await categoryService.create(body));
  },
  async updateCategory(_req: Request, res: Response) {
    const { params, body } = validated<{
      params: Id;
      body: { name?: string; icon?: string; isActive?: boolean };
    }>(res);
    res.json(await categoryService.update(params.id, body));
  },
  async getSettings(_req: Request, res: Response) {
    res.json(await adminService.getSettings());
  },
  async putSettings(_req: Request, res: Response) {
    const { body } = validated<{ body: Partial<Settings> }>(res);
    res.json(await adminService.updateSettings(body));
  },
  async admins(_req: Request, res: Response) {
    res.json(await adminService.listAdmins());
  },
  async createAdmin(_req: Request, res: Response) {
    const { body } = validated<{
      body: { name: string; email: string; password: string };
    }>(res);
    res.status(201).json(await adminService.createAdmin(body));
  },
  async removeAdmin(req: Request, res: Response) {
    const { params } = validated<{ params: Id }>(res);
    await adminService.removeAdmin(params.id, currentUser(req));
    res.status(204).end();
  },
};
