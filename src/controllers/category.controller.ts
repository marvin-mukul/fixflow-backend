import type { Request, Response } from "express";
import { categoryService } from "../services/category.service.js";

export const categoryController = {
  async list(_req: Request, res: Response) {
    res.json(await categoryService.listActive());
  },
};
