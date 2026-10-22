/**
 * Idempotency layer for state-changing MCP tools (Requirement 1.5).
 *
 * State-changing tools accept an `idempotencyKey`. The first invocation for a
 * given key runs the handler and records its result; any later invocation with
 * the same key returns the stored result WITHOUT re-running the handler, so the
 * side effects never happen twice.
 *
 * The store is defined behind an interface so a durable backend (DynamoDB, a
 * JSON repository, etc.) can replace the in-memory implementation in later
 * tasks without touching the router.
 */

/**
 * A persistent record of the first result produced for an idempotency key.
 */
export interface IdempotencyRecord<TResult = unknown> {
  /** The key under which the result was recorded. */
  readonly key: string;
  /** The logical tool the key belongs to. Keys are scoped per tool. */
  readonly toolName: string;
  /** The stored result returned verbatim on replay. */
  readonly result: TResult;
  /** ISO-8601 timestamp of when the record was first written. */
  readonly recordedAt: string;
}

/**
 * Storage abstraction for idempotency records. Implementations must treat the
 * composite of `toolName` and `key` as the uniqueness boundary: the same raw
 * key used by two different tools is two distinct records.
 */
export interface IdempotencyStore {
  /**
   * Return the stored record for a tool/key pair, or `undefined` if the key has
   * not been recorded yet.
   */
  get<TResult>(toolName: string, key: string): Promise<IdempotencyRecord<TResult> | undefined>;

  /**
   * Record the first result for a tool/key pair. If a record already exists it
   * is left untouched and the existing record is returned, guaranteeing a
   * single stored result per key even under concurrent first-writes.
   */
  put<TResult>(toolName: string, key: string, result: TResult): Promise<IdempotencyRecord<TResult>>;
}

/**
 * In-memory {@link IdempotencyStore} suitable for the POC and for tests. State
 * lives for the lifetime of the process only.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly #records = new Map<string, IdempotencyRecord<unknown>>();

  #compositeKey(toolName: string, key: string): string {
    // Length-prefix the tool name so that distinct (toolName, key) pairs can
    // never collide into the same composite string.
    return `${toolName.length}:${toolName}:${key}`;
  }

  async get<TResult>(toolName: string, key: string): Promise<IdempotencyRecord<TResult> | undefined> {
    const record = this.#records.get(this.#compositeKey(toolName, key));
    return record as IdempotencyRecord<TResult> | undefined;
  }

  async put<TResult>(toolName: string, key: string, result: TResult): Promise<IdempotencyRecord<TResult>> {
    const composite = this.#compositeKey(toolName, key);
    const existing = this.#records.get(composite);
    if (existing) {
      return existing as IdempotencyRecord<TResult>;
    }
    const record: IdempotencyRecord<TResult> = {
      key,
      toolName,
      result,
      recordedAt: new Date().toISOString(),
    };
    this.#records.set(composite, record as IdempotencyRecord<unknown>);
    return record;
  }
}
