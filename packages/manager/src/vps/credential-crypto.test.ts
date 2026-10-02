import { describe, it, expect, afterEach } from "vitest";
import { encryptPrivateKey, decryptPrivateKey, isPasteKeyEnabled } from "./credential-crypto.js";

describe("credential-crypto", () => {
  const orig = { GENIE_SECRET: process.env.GENIE_SECRET, GENIE_JWT_SECRET: process.env.GENIE_JWT_SECRET };
  afterEach(() => {
    process.env.GENIE_SECRET = orig.GENIE_SECRET;
    process.env.GENIE_JWT_SECRET = orig.GENIE_JWT_SECRET;
  });

  it("round-trips with a real secret, with a fresh salt + iv per call", () => {
    process.env.GENIE_SECRET = "a-real-manager-secret";
    delete process.env.GENIE_JWT_SECRET;
    expect(isPasteKeyEnabled()).toBe(true);

    const key = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----\n";
    const a = encryptPrivateKey(key);
    const b = encryptPrivateKey(key);
    expect(a.salt).not.toEqual(b.salt);   // per-row salt
    expect(a.iv).not.toEqual(b.iv);        // per-row iv
    expect(a.ciphertext).not.toEqual(b.ciphertext);
    expect(decryptPrivateKey(a)).toBe(key);
    expect(decryptPrivateKey(b)).toBe(key);
  });

  it("is disabled and refuses to encrypt without a real secret", () => {
    delete process.env.GENIE_SECRET;
    delete process.env.GENIE_JWT_SECRET;
    expect(isPasteKeyEnabled()).toBe(false);
    expect(() => encryptPrivateKey("x")).toThrow();

    process.env.GENIE_JWT_SECRET = "genie-secret-fallback"; // the insecure default
    expect(isPasteKeyEnabled()).toBe(false);
    expect(() => encryptPrivateKey("x")).toThrow();
  });

  it("falls back to GENIE_JWT_SECRET when GENIE_SECRET is unset", () => {
    delete process.env.GENIE_SECRET;
    process.env.GENIE_JWT_SECRET = "jwt-secret-value";
    expect(isPasteKeyEnabled()).toBe(true);
    const enc = encryptPrivateKey("hello");
    expect(decryptPrivateKey(enc)).toBe("hello");
  });

  it("cannot decrypt with a different secret", () => {
    process.env.GENIE_SECRET = "secret-A";
    const enc = encryptPrivateKey("payload");
    process.env.GENIE_SECRET = "secret-B";
    expect(() => decryptPrivateKey(enc)).toThrow();
  });
});
