import type { GlobalRole } from "../generated/prisma/enums.js";

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      name: string;
      globalRole: GlobalRole;
      mustChangePassword: boolean;
    }
    interface Request {
      id: string;
    }
  }
}

export {};
