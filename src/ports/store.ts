/**
 * ports/store.ts — Simple key-value and query store interface.
 * ABY implements this with SQLite; Rijin stores review-domain records.
 */
export interface StorePort {
  /** Upsert a record by its ID */
  put(collection: string, id: string, record: unknown): Promise<void>;

  /** Retrieve a record by ID */
  get(collection: string, id: string): Promise<unknown | null>;

  /** Query by a field value */
  query(collection: string, field: string, value: unknown): Promise<unknown[]>;

  /** Delete a record */
  delete(collection: string, id: string): Promise<void>;
}
