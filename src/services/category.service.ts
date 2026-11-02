import { categoryRepository } from "../repositories/category.repository.js";

const toDto = (c: {
  id: string;
  slug: string;
  name: string;
  icon: string;
  isActive: boolean;
}) => ({
  id: c.id,
  slug: c.slug,
  name: c.name,
  icon: c.icon,
  isActive: c.isActive,
});

export const categoryService = {
  async listActive() {
    return { items: (await categoryRepository.listActive()).map(toDto) };
  },
  async listAll() {
    return { items: (await categoryRepository.listAll()).map(toDto) };
  },
  async create(input: { slug: string; name: string; icon: string }) {
    return toDto(await categoryRepository.create(input));
  },
  async update(
    id: string,
    input: { name?: string; icon?: string; isActive?: boolean },
  ) {
    return toDto(await categoryRepository.update(id, input));
  },
};
