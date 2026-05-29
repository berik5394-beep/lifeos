import { describe, it, expect } from 'vitest';
import { WorkingMemory } from './working-memory.js';

describe('WorkingMemory — addTurn + getContext', () => {
  it('adds new turn to user context', () => {
    const wm = new WorkingMemory();
    const ts = new Date();
    wm.addTurn('user1', { role: 'user', content: 'hello', ts });
    const ctx = wm.getContext('user1');
    expect(ctx).not.toBeNull();
    expect(ctx?.lastMessages).toHaveLength(1);
    expect(ctx?.lastMessages[0].content).toBe('hello');
    expect(ctx?.lastMessages[0].role).toBe('user');
  });

  it('appends multiple turns in order', () => {
    const wm = new WorkingMemory();
    wm.addTurn('user1', { role: 'user', content: 'a', ts: new Date(1) });
    wm.addTurn('user1', { role: 'assistant', content: 'b', ts: new Date(2) });
    wm.addTurn('user1', { role: 'user', content: 'c', ts: new Date(3) });
    const ctx = wm.getContext('user1');
    expect(ctx?.lastMessages.map((m) => m.content)).toEqual(['a', 'b', 'c']);
  });

  it('isolates contexts per userId', () => {
    const wm = new WorkingMemory();
    wm.addTurn('u1', { role: 'user', content: 'A', ts: new Date() });
    wm.addTurn('u2', { role: 'user', content: 'B', ts: new Date() });
    expect(wm.getContext('u1')?.lastMessages[0].content).toBe('A');
    expect(wm.getContext('u2')?.lastMessages[0].content).toBe('B');
  });

  it('returns null for unknown user', () => {
    const wm = new WorkingMemory();
    expect(wm.getContext('nonexistent')).toBeNull();
  });

  it('updates lastActivityAt on each addTurn', () => {
    const wm = new WorkingMemory();
    const t1 = new Date(100);
    const t2 = new Date(200);
    wm.addTurn('u1', { role: 'user', content: 'x', ts: t1 });
    expect(wm.getContext('u1')?.lastActivityAt).toEqual(t1);
    wm.addTurn('u1', { role: 'user', content: 'y', ts: t2 });
    expect(wm.getContext('u1')?.lastActivityAt).toEqual(t2);
  });
});

describe('WorkingMemory — bounded queue (anti memory-leak)', () => {
  it('keeps only last N msgs (default 50)', () => {
    const wm = new WorkingMemory();
    for (let i = 0; i < 60; i++) {
      wm.addTurn('u1', { role: 'user', content: `msg${i}`, ts: new Date(i) });
    }
    const ctx = wm.getContext('u1');
    expect(ctx?.lastMessages).toHaveLength(50);
    // Should keep most recent 50 (msg10..msg59)
    expect(ctx?.lastMessages[0].content).toBe('msg10');
    expect(ctx?.lastMessages[49].content).toBe('msg59');
  });

  it('respects custom maxMessages option', () => {
    const wm = new WorkingMemory({ maxMessages: 5 });
    for (let i = 0; i < 10; i++) {
      wm.addTurn('u1', { role: 'user', content: `${i}`, ts: new Date(i) });
    }
    const ctx = wm.getContext('u1');
    expect(ctx?.lastMessages).toHaveLength(5);
    expect(ctx?.lastMessages.map((m) => m.content)).toEqual(['5', '6', '7', '8', '9']);
  });
});

describe('WorkingMemory — evictIdle', () => {
  it('evicts contexts idle > threshold (default 1 hour)', () => {
    const wm = new WorkingMemory();
    const now = new Date();
    const oldTs = new Date(now.getTime() - 90 * 60 * 1000); // 90 min ago
    wm.addTurn('idle', { role: 'user', content: 'old', ts: oldTs });
    wm.addTurn('active', { role: 'user', content: 'new', ts: now });

    const evicted = wm.evictIdle(now);

    expect(evicted).toBe(1);
    expect(wm.getContext('idle')).toBeNull();
    expect(wm.getContext('active')).not.toBeNull();
  });

  it('respects custom idleThresholdMs', () => {
    const wm = new WorkingMemory({ idleThresholdMs: 5_000 });
    const now = new Date();
    const oldTs = new Date(now.getTime() - 10_000);
    wm.addTurn('u1', { role: 'user', content: 'x', ts: oldTs });
    wm.evictIdle(now);
    expect(wm.getContext('u1')).toBeNull();
  });

  it('returns 0 when nothing to evict', () => {
    const wm = new WorkingMemory();
    expect(wm.evictIdle()).toBe(0);
    wm.addTurn('u1', { role: 'user', content: 'fresh', ts: new Date() });
    expect(wm.evictIdle()).toBe(0);
  });
});

describe('WorkingMemory — size', () => {
  it('reports active context count', () => {
    const wm = new WorkingMemory();
    expect(wm.size()).toBe(0);
    wm.addTurn('u1', { role: 'user', content: 'x', ts: new Date() });
    expect(wm.size()).toBe(1);
    wm.addTurn('u2', { role: 'user', content: 'y', ts: new Date() });
    expect(wm.size()).toBe(2);
  });
});
