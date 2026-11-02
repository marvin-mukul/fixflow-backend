import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

export const ErrorEnvelopeSchema = registry.register(
  "ErrorEnvelope",
  z
    .object({
      error: z.object({
        code: z.string().openapi({ example: "NOT_FOUND" }),
        message: z.string().openapi({ example: "Resource not found" }),
        details: z.array(
          z.object({
            path: z.string().optional(),
            message: z.string(),
            code: z.string().optional(),
          }),
        ),
        requestId: z
          .string()
          .openapi({ example: "6f1c1c2e-8a5e-4f7e-9d0a-3c2b1a0f9e8d" }),
      }),
    })
    .openapi({ description: "Envelope returned for every non-2xx response" }),
);

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT / INVALID_TRANSITION",
  422: "VALIDATION_ERROR",
  429: "RATE_LIMITED",
  500: "INTERNAL",
  503: "SERVICE_UNAVAILABLE",
};

/** Builds the `responses` entries for the error codes an endpoint can return. */
export function errorResponses(...statuses: number[]) {
  return Object.fromEntries(
    statuses.map((s) => [
      s,
      {
        description: ERROR_DESCRIPTIONS[s] ?? "Error",
        content: { "application/json": { schema: ErrorEnvelopeSchema } },
      },
    ]),
  );
}

export function buildOpenApiDocument() {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "FixFlow API",
      version: "1.0.0",
      description:
        "Home repair marketplace API. All errors use the `ErrorEnvelope` shape.",
    },
    servers: [{ url: "/" }],
  });
}

/** `content` helper for request/response bodies. */
export const json = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

export const ok = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: json(schema),
});
