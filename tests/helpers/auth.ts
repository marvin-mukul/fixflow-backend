import bcrypt from "bcryptjs";
import type { GlobalRole } from "../../src/generated/prisma/enums.js";
import { prisma } from "../../src/lib/prisma.js";
import { api } from "./app.js";

export const TEST_PASSWORD = "Test@1234";
// Cost 4 keeps tests fast; production code always uses 12.
const testHash = bcrypt.hashSync(TEST_PASSWORD, 4);
let n = 0;

export async function createUser(
  overrides: Partial<{
    email: string;
    name: string;
    role: GlobalRole;
    mustChangePassword: boolean;
    phone: string;
  }> = {},
) {
  n += 1;
  return prisma.user.create({
    data: {
      email: overrides.email ?? `user${n}-${Date.now()}@test.fixflow`,
      name: overrides.name ?? `User ${n}`,
      globalRole: overrides.role ?? "CUSTOMER",
      passwordHash: testHash,
      mustChangePassword: overrides.mustChangePassword ?? false,
      phone: overrides.phone ?? null,
    },
  });
}

/** Logs in and returns the bearer token + refresh cookie. */
export async function login(email: string, password = TEST_PASSWORD) {
  const res = await api().post("/api/v1/auth/login").send({ email, password });
  if (res.status !== 200)
    throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  return {
    token: res.body.accessToken as string,
    cookie: cookies[0]!.split(";")[0]!,
    user: res.body.user,
  };
}

export async function userWithToken(
  role: GlobalRole = "CUSTOMER",
  extra: Parameters<typeof createUser>[0] = {},
) {
  const user = await createUser({ role, ...extra });
  const { token } = await login(user.email);
  return { user, token, auth: { Authorization: `Bearer ${token}` } };
}
