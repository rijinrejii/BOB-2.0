/**
 * ports/metadata.ts — Interface for reading PR metadata.
 * Metadata is untrusted input; the port returns unknown for validation.
 */
export interface MetadataPort {
  /** Load raw PR metadata from a file path. Returns unknown for Zod validation. */
  loadRaw(path: string): Promise<unknown>;
}
