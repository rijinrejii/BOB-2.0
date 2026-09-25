/**
 * adapters/sqlite/sqlite-evidence-adapter.ts
 *
 * SQLite-backed EvidencePort implementation.
 * Delegates storage to SqliteStore's kv_store table.
 */
import type { EvidencePort } from "../../ports/repository.js";
import type { EvidenceRecord } from "../../contracts/index.js";
import type { SqliteStore } from "./sqlite-store.js";

const COLLECTION = "evidence";

export class SqliteEvidenceAdapter implements EvidencePort {
  constructor(private readonly store: SqliteStore) {}

  async storeEvidence(record: EvidenceRecord): Promise<void> {
    await this.store.put(COLLECTION, record.evidenceId, record);
  }

  async getEvidence(evidenceId: string): Promise<EvidenceRecord | null> {
    const raw = await this.store.get(COLLECTION, evidenceId);
    if (raw === null) return null;
    return raw as EvidenceRecord;
  }

  async getEvidenceForRun(runId: string): Promise<EvidenceRecord[]> {
    const rows = await this.store.query(COLLECTION, "runId", runId);
    return rows as EvidenceRecord[];
  }
}
