import supertest from "supertest";
import { createApp } from "../../src/app.js";

/** Builds the Express app without listening, wrapped for Supertest. */
export function api() {
  return supertest(createApp());
}
