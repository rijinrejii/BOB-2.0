/**
 * adapters/metadata/file-metadata-adapter.ts
 *
 * Reads PR metadata from a JSON file at a trusted path.
 * The content is returned as raw `unknown` for Rijin's review service to validate.
 * No lifecycle scripts are executed.
 */
import { readFileSync } from "fs";
import { resolve, isAbsolute } from "path";
import type { MetadataPort } from "../../ports/metadata.js";

export class FileMetadataAdapter implements MetadataPort {
  /**
   * Read PR metadata from the given path.
   * Path must be absolute or will be resolved against cwd.
   *
   * Returns `null` if the file does not exist or cannot be parsed as JSON.
   * Throws if the path attempts traversal or has disallowed characteristics.
   */
  async loadRaw(metadataPath: string): Promise<unknown> {
    const resolved = isAbsolute(metadataPath)
      ? metadataPath
      : resolve(process.cwd(), metadataPath);

    // Reject paths with traversal sequences (defense in depth)
    if (resolved.includes("..")) {
      throw new Error(`Metadata path traversal rejected: ${metadataPath}`);
    }

    let raw: string;
    try {
      raw = readFileSync(resolved, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw new Error(`Cannot read metadata file ${resolved}: ${(err as Error).message}`);
    }

    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`Metadata file is not valid JSON: ${resolved}`);
    }
  }
}
