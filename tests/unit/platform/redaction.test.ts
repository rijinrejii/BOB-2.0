/**
 * tests/unit/platform/redaction.test.ts
 *
 * Tests for secret redaction.
 * Required: secret-bearing logs must be redacted.
 */
import { describe, it, expect } from "vitest";
import { redactSecrets } from "../../../src/platform/redaction.js";

describe("redactSecrets", () => {
  it("redacts OpenAI API keys", () => {
    const text = "Using key sk-abcdefghijklmnopqrstuvwxyz012345 for request";
    const result = redactSecrets(text);
    expect(result).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts GitHub tokens", () => {
    // ghp_ followed by exactly 36 alphanumeric chars
    const token = "ghp_" + "A".repeat(36);
    const text = `GITHUB_TOKEN=${token}`;
    const result = redactSecrets(text);
    expect(result).not.toContain(token);
    expect(result).toContain("[REDACTED]");
  });

  it("redacts AWS access key IDs", () => {
    const text = "AWS key: AKIAIOSFODNN7EXAMPLE";
    const result = redactSecrets(text);
    expect(result).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result).toContain("[REDACTED]");
  });

  it("does not redact plain text without secrets", () => {
    const text = "This is a normal log message with no secrets.";
    const result = redactSecrets(text);
    expect(result).toBe(text);
  });

  it("preserves surrounding context outside the secret", () => {
    const text = "Calling API at https://example.com, key=sk-abcdefghijklmnopqrstuvwxyz012345, done.";
    const result = redactSecrets(text);
    expect(result).toContain("https://example.com");
    expect(result).toContain("done.");
    expect(result).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
  });
});
