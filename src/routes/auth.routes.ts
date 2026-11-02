import { Router } from "express";
import { authController } from "../controllers/auth.controller.js";
import { errorResponses, json, registry } from "../lib/openapi.js";
import { authenticateLocal, requireAuth } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import {
  AuthResponse,
  ChangePasswordBody,
  LoginBody,
  RegisterBody,
  UserDto,
} from "../schemas/auth.schema.js";
import { BEARER } from "../schemas/common.schema.js";

export const authRouter = Router();
const me = requireAuth({ allowPendingPasswordChange: true });

authRouter.post(
  "/auth/register",
  validate({ body: RegisterBody }),
  authController.register,
);
authRouter.post(
  "/auth/login",
  validate({ body: LoginBody }),
  authenticateLocal,
  authController.login,
);
authRouter.post("/auth/refresh", authController.refresh);
authRouter.post("/auth/logout", authController.logout);
authRouter.get("/auth/me", me, authController.me);
authRouter.post(
  "/auth/change-password",
  me,
  validate({ body: ChangePasswordBody }),
  authController.changePassword,
);

const session = {
  description:
    "Access token in body; rotating refresh token set as httpOnly cookie `ff_refresh` (path /api/v1/auth)",
  content: json(AuthResponse),
};

registry.registerPath({
  method: "post",
  path: "/api/v1/auth/register",
  tags: ["Auth"],
  summary: "Register a customer or worker",
  request: { body: { content: json(RegisterBody) } },
  responses: { 201: session, ...errorResponses(409, 422, 429) },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/auth/login",
  tags: ["Auth"],
  summary: "Log in with email + password",
  description:
    "Seeded demo users use `Demo@123`. Superadmin must change password first.",
  request: { body: { content: json(LoginBody) } },
  responses: { 200: session, ...errorResponses(401, 403, 422, 429) },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/auth/refresh",
  tags: ["Auth"],
  summary: "Rotate the refresh cookie and get a new access token",
  description:
    "Reusing an already-rotated token revokes the whole token family.",
  responses: { 200: session, ...errorResponses(401, 403, 429) },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/auth/logout",
  tags: ["Auth"],
  summary: "Revoke the refresh token family and clear the cookie",
  responses: { 204: { description: "Logged out" }, ...errorResponses(429) },
});
registry.registerPath({
  method: "get",
  path: "/api/v1/auth/me",
  tags: ["Auth"],
  summary: "Current user",
  security: BEARER,
  responses: {
    200: { description: "Current user", content: json(UserDto) },
    ...errorResponses(401),
  },
});
registry.registerPath({
  method: "post",
  path: "/api/v1/auth/change-password",
  tags: ["Auth"],
  summary:
    "Change password (clears mustChangePassword, revokes other sessions)",
  security: BEARER,
  request: { body: { content: json(ChangePasswordBody) } },
  responses: { 200: session, ...errorResponses(401, 422, 429) },
});
