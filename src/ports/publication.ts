/**
 * ports/publication.ts — Interface for publishing a review externally.
 */
import type { PublicationRecord, ReviewReport } from "../contracts/index.js";

export interface PublicationPort {
  /** Publish a review report. Returns a publication record. */
  publish(report: ReviewReport, headCommit: string): Promise<PublicationRecord>;
}
