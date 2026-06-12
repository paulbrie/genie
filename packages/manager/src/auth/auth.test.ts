import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { createToken, verifyToken } from "./auth.js";

describe("auth (JWT helpers)", () => {
  it("roundtrips userId through create/verify", () => {
    const token = createToken("user-123");
    const decoded = verifyToken(token);
    expect(decoded?.userId).toBe("user-123");
    expect(decoded?.impersonatedBy).toBeUndefined();
  });

  it("preserves impersonatedBy when set", () => {
    const token = createToken("user-123", "admin-7");
    const decoded = verifyToken(token);
    expect(decoded).toEqual(
      expect.objectContaining({ userId: "user-123", impersonatedBy: "admin-7" }),
    );
  });

  it("omits impersonatedBy from the payload when not supplied", () => {
    // Important so the cookie/payload doesn't carry a stray `impersonatedBy:
    // undefined` field that downstream code might treat as truthy after a
    // serializer trip.
    const token = createToken("user-123");
    const raw = jwt.decode(token) as Record<string, unknown>;
    expect("impersonatedBy" in raw).toBe(false);
  });

  it("returns null on a malformed token instead of throwing", () => {
    expect(verifyToken("not-a-jwt")).toBeNull();
    expect(verifyToken("")).toBeNull();
  });

  it("returns null on a token signed with a different secret", () => {
    const forged = jwt.sign({ userId: "attacker" }, "wrong-secret", { expiresIn: "30d" });
    expect(verifyToken(forged)).toBeNull();
  });

  it("returns null on an expired token", () => {
    const expired = jwt.sign(
      { userId: "user-123" },
      process.env.GENIE_JWT_SECRET || process.env.ANTHROPIC_API_KEY || "genie-secret-fallback",
      { expiresIn: -1 },
    );
    expect(verifyToken(expired)).toBeNull();
  });
});
