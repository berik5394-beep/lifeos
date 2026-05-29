/**
 * v2.0 Tier 1 — Working Memory.
 *
 * In-process краткосрочный контекст текущего разговора. Last N msgs
 * (bounded queue — anti memory-leak) + fresh entities + active mood.
 * Используется для context enrichment в каждом jarvis response (Week 5).
 *
 * Lifespan: минуты-часы → idle eviction → консолидируется в Episodic
 * (delegate to Week 5 integration).
 *
 * Pure in-memory, no prisma. Fully unit-testable.
 */

export type WorkingTurn = {
  role: 'user' | 'assistant';
  content: string;
  ts: Date;
};

export type WorkingContext = {
  userId: string;
  lastMessages: WorkingTurn[];
  freshEntities: Set<string>; // entity ids mentioned in last hour
  currentMood: number;         // -1..+1, decay over time (Week 4 wires this)
  lastActivityAt: Date;
};

export type WorkingMemoryOptions = {
  /** Max msgs retained per user (bounded queue). Default 50. */
  maxMessages?: number;
  /** Idle threshold ms — older → evicted. Default 1 hour. */
  idleThresholdMs?: number;
};

export class WorkingMemory {
  private contexts = new Map<string, WorkingContext>();
  private readonly maxMessages: number;
  private readonly idleThresholdMs: number;

  constructor(opts: WorkingMemoryOptions = {}) {
    this.maxMessages = opts.maxMessages ?? 50;
    // Fix 2026-05-29 (code-review): maxMessages=0 produces undefined behavior
    // (queue always empty but context object still exists, confusing for callers).
    // Reject < 1 explicitly.
    if (this.maxMessages < 1) {
      throw new Error(`WorkingMemory: maxMessages must be >= 1, got ${this.maxMessages}`);
    }
    this.idleThresholdMs = opts.idleThresholdMs ?? 60 * 60 * 1000;
  }

  /**
   * Add new turn to user's working context. O(1) amortized.
   * Creates context if not exists. Trims oldest if exceeds maxMessages.
   *
   * CALLER CONTRACT: msg.ts must be wall-clock time of the turn (NOT a
   * historical timestamp from replayed storage). lastActivityAt is set
   * from msg.ts and drives evictIdle — replaying old messages on cache
   * warmup will immediately evict the context.
   */
  addTurn(userId: string, msg: WorkingTurn): void {
    let ctx = this.contexts.get(userId);
    if (!ctx) {
      ctx = {
        userId,
        lastMessages: [],
        freshEntities: new Set(),
        currentMood: 0,
        lastActivityAt: msg.ts,
      };
      this.contexts.set(userId, ctx);
    }
    ctx.lastMessages.push(msg);
    // Bounded queue — drop oldest if exceeds limit
    if (ctx.lastMessages.length > this.maxMessages) {
      ctx.lastMessages.splice(0, ctx.lastMessages.length - this.maxMessages);
    }
    ctx.lastActivityAt = msg.ts;
  }

  /**
   * Get current context snapshot. O(1).
   * Returns null if no context exists.
   *
   * CALLER CONTRACT: returned object is a LIVE reference (not cloned for
   * performance). Callers MUST NOT mutate lastMessages directly — use
   * addTurn() to preserve bounded-queue invariant. Reading is safe.
   */
  getContext(userId: string): WorkingContext | null {
    return this.contexts.get(userId) ?? null;
  }

  /**
   * Evict contexts idle longer than idleThresholdMs.
   * Called periodically (Week 5 — every 5 min from scheduler).
   * Returns number of evicted.
   */
  evictIdle(now: Date = new Date()): number {
    const cutoff = now.getTime() - this.idleThresholdMs;
    let evicted = 0;
    for (const [userId, ctx] of this.contexts) {
      if (ctx.lastActivityAt.getTime() < cutoff) {
        this.contexts.delete(userId);
        evicted++;
      }
    }
    return evicted;
  }

  /**
   * Active context count — for introspection / metrics.
   */
  size(): number {
    return this.contexts.size;
  }
}

/**
 * Global singleton instance — created lazily.
 * Wired into jarvis-orchestrator in Week 5 (separate plan).
 */
let _instance: WorkingMemory | null = null;

export function getWorkingMemory(): WorkingMemory {
  if (!_instance) {
    _instance = new WorkingMemory();
  }
  return _instance;
}

/**
 * For tests only — clear singleton between test files / cases.
 * Underscore prefix signals "internal API".
 */
export function _resetWorkingMemoryForTests(): void {
  _instance = null;
}
