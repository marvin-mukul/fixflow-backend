import { Writable } from "node:stream";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { loggerOptions } from "../../src/lib/logger.js";

describe("log redaction", () => {
  it("never writes secrets, tokens or passwords", () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const log = pino({ ...loggerOptions, level: "info" }, sink);
    log.info({
      req: {
        headers: {
          authorization: "Bearer eyJsecret",
          cookie: "ff_refresh=abc",
        },
      },
      body: {
        password: "Demo@123",
        newPassword: "X@1234567",
        refreshToken: "rt",
        accessToken: "at",
      },
      cfg: { CASHFREE_SECRET_KEY: "cfsk_live", secret: "s3" },
    });
    const out = lines.join("");
    for (const leaked of [
      "eyJsecret",
      "ff_refresh=abc",
      "Demo@123",
      "X@1234567",
      "cfsk_live",
      '"rt"',
      '"at"',
      '"s3"',
    ]) {
      expect(out).not.toContain(leaked);
    }
    expect(out).toContain("[redacted]");
  });
});
