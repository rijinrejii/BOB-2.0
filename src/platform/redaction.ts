/**
 * platform/redaction.ts
 *
 * Pattern-based secret redaction for log strings and text before persistence
 * or publication.
 *
 * IMPORTANT LIMITATION: This is pattern-based and is NOT exhaustive.
 * Custom secret formats will not be redacted. Do not use as a DLP solution.
 * Document redaction limitations; do not claim complete secret removal.
 */

const REDACTED = "[REDACTED]";

interface RedactionPattern {
  name: string;
  pattern: RegExp;
}

/**
 * Common secret patterns. Each pattern captures the value to be redacted
 * using a named capture group `secret`.
 */
const PATTERNS: RedactionPattern[] = [
  // API keys / bearer tokens
  {
    name: "bearer-token",
    pattern: /Bearer\s+([A-Za-z0-9\-._~+/]+=*)/gi,
  },
  // OpenAI API key format
  {
    name: "openai-key",
    pattern: /sk-[A-Za-z0-9]{20,}/g,
  },
  // Generic key=value patterns
  {
    name: "api-key-header",
    pattern: /(api[_-]?key|apikey|api[_-]?secret|secret[_-]?key|access[_-]?token|auth[_-]?token)[=:\s"']+([A-Za-z0-9\-._~+/]{16,})/gi,
  },
  // Password patterns
  {
    name: "password",
    pattern: /(password|passwd|pwd)[=:\s"']+([^\s"',}{[\]]{8,})/gi,
  },
  // Connection strings with embedded credentials
  {
    name: "connection-string",
    pattern: /([a-z]+:\/\/)([^:]+):([^@]+)@/gi,
  },
  // GitHub personal access tokens
  {
    name: "github-token",
    pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g,
  },
  // AWS access key ID pattern
  {
    name: "aws-access-key",
    pattern: /AKIA[0-9A-Z]{16}/g,
  },
];

/**
 * Redact common secret patterns from text.
 *
 * Does NOT guarantee exhaustive redaction. Returns the text with
 * known patterns replaced by `[REDACTED]`.
 *
 * Note: connection strings replace only the password segment.
 */
export function redactSecrets(text: string): string {
  let result = text;

  for (const { pattern } of PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;

    // Connection string: preserve scheme and host, redact password
    if (pattern.source.includes("connection-string")) {
      result = result.replace(pattern, `$1$2:${REDACTED}@`);
    } else if (pattern.source.includes("api-key-header") || pattern.source.includes("password")) {
      // Two-group: redact second group (the value)
      result = result.replace(pattern, (match: string, key: string) => {
        return match.replace(match.slice(key.length), REDACTED);
      });
    } else {
      result = result.replace(pattern, REDACTED);
    }
  }

  return result;
}
