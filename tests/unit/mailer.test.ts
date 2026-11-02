import { describe, expect, it } from "vitest";
import { parseAddress } from "../../src/lib/mailer.js";

describe("parseAddress", () => {
  it("splits a display name and address", () => {
    expect(parseAddress("FixFlow <no-reply@fixflow.app>")).toEqual({
      name: "FixFlow",
      email: "no-reply@fixflow.app",
    });
  });
  it("handles a quoted display name", () => {
    expect(parseAddress('"Fix Flow" <a@b.co>')).toEqual({
      name: "Fix Flow",
      email: "a@b.co",
    });
  });
  it("accepts a bare address", () => {
    expect(parseAddress(" a@b.co ")).toEqual({ email: "a@b.co" });
  });
  it("drops an empty display name", () => {
    expect(parseAddress("<a@b.co>")).toEqual({ email: "a@b.co" });
  });
});
