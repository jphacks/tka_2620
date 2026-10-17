// The helpers every handler in app/api/ uses, offline: no Supabase, no network.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiErrorCode } from "@/lib/contracts";
import {
  ApiFailure,
  apiError,
  bearerToken,
  callerFor,
  dbFailure,
  failed,
} from "@/lib/engine/route";

// seed/questions.csv q04: text that must never reach a log.
const QUESTION = "決算後に申請された領収書はどうすれば良いですか？";

function withAuthorization(header?: string): Request {
  return new Request("http://localhost/api/ask", {
    method: "POST",
    headers: header === undefined ? {} : { authorization: header },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("bearerToken", () => {
  it.each([
    ["Bearer abc.def.ghi", "abc.def.ghi"],
    ["bearer abc.def.ghi", "abc.def.ghi"],
    ["Bearer   abc.def.ghi", "abc.def.ghi"],
  ])("reads the token in %j", (header, token) => {
    expect(bearerToken(withAuthorization(header))).toBe(token);
  });

  it.each([
    undefined,
    "",
    "Bearer",
    "Bearer   ",
    "Basic abc",
    "Bearer a b",
  ])("finds none in %j", (header) => {
    expect(bearerToken(withAuthorization(header))).toBeUndefined();
  });
});

describe("apiError", () => {
  it.each([
    ["invalid_request", 400],
    ["unauthorized", 401],
    ["forbidden", 403],
    ["not_found", 404],
    ["unredacted", 422],
    ["unavailable", 503],
  ] as const)("answers %s with %i", async (code, status) => {
    const response = apiError(code);
    expect(response.status).toBe(status);
    expect(ApiError.parse(await response.json()).error).toBe(code);
  });

  it("knows every error code", () => {
    for (const code of ApiErrorCode.options) {
      expect(apiError(code).status).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("dbFailure", () => {
  it("turns a policy refusal into forbidden and anything else into unavailable", () => {
    expect(dbFailure({ code: "42501" }).code).toBe("forbidden");
    expect(dbFailure({ code: "23505" }).code).toBe("unavailable");
    expect(dbFailure(null).code).toBe("unavailable");
  });
});

describe("failed", () => {
  it("answers an ApiFailure with its code", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(failed("POST /api/ask", new ApiFailure("not_found")).status).toBe(
      404,
    );
    expect(log).toHaveBeenCalledWith(
      "POST /api/ask failed: not_found (ApiFailure)",
    );
  });

  it("answers anything else as unavailable, and never logs a message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = failed(
      "POST /api/ask",
      new TypeError(`could not send ${QUESTION}`),
    );
    expect(response.status).toBe(503);
    expect(ApiError.parse(await response.json()).error).toBe("unavailable");
    expect(log).toHaveBeenCalledWith(
      "POST /api/ask failed: unavailable (TypeError)",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(QUESTION);
  });
});

describe("callerFor", () => {
  it("is unavailable, never anonymous, when Supabase isn't configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    await expect(callerFor("abc.def.ghi")).rejects.toMatchObject({
      name: "ApiFailure",
      code: "unavailable",
    });
  });
});
