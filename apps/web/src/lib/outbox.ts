import type { CreateOrderInput, OrderDto } from '@bestellsystem/shared';
import { useSyncExternalStore } from 'react';
import { api, ApiError } from './api';
import { storage } from './storage';

export interface PendingOrder {
  input: CreateOrderInput;
  label: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export interface FailedOrder {
  label: string;
  error: string;
  at: number;
}

const KEY = 'order-outbox';
const FAILED_KEY = 'order-outbox-failed';

type Listener = () => void;

/**
 * Warteschlange für Bestellungen, die wegen Netzproblemen nicht ankamen. Die
 * Bestellung behält ihre ID – der Server erkennt Wiederholungen und druckt
 * nichts doppelt.
 */
class Outbox {
  private pending: PendingOrder[] = storage.get<PendingOrder[]>(KEY, []);
  private failed: FailedOrder[] = storage.get<FailedOrder[]>(FAILED_KEY, []);
  private listeners = new Set<Listener>();
  private timer: number | null = null;
  private flushing = false;
  private snapshot = { pending: this.pending, failed: this.failed };
  onDelivered: ((order: OrderDto, label: string) => void) | null = null;

  constructor() {
    window.addEventListener('online', () => void this.flush());
    if (this.pending.length > 0) this.schedule();
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  private changed() {
    storage.set(KEY, this.pending);
    storage.set(FAILED_KEY, this.failed);
    this.snapshot = { pending: [...this.pending], failed: [...this.failed] };
    for (const l of this.listeners) l();
  }

  private schedule() {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 3000);
  }

  /** Sendet sofort; bei Netzproblemen landet die Bestellung in der Warteschlange. */
  async send(input: CreateOrderInput, label: string): Promise<{ order: OrderDto } | { queued: true }> {
    try {
      const order = await api.post<OrderDto>('/api/orders', input, { timeoutMs: 8000 });
      return { order };
    } catch (err) {
      if (err instanceof ApiError && err.isNetwork) {
        this.pending.push({ input, label, createdAt: Date.now(), attempts: 1, lastError: err.message });
        this.changed();
        this.schedule();
        return { queued: true };
      }
      throw err;
    }
  }

  async flush() {
    if (this.flushing || this.pending.length === 0) return;
    this.flushing = true;
    try {
      for (const entry of [...this.pending]) {
        try {
          const order = await api.post<OrderDto>('/api/orders', entry.input, { timeoutMs: 8000 });
          this.pending = this.pending.filter((p) => p !== entry);
          this.changed();
          this.onDelivered?.(order, entry.label);
        } catch (err) {
          if (err instanceof ApiError && !err.isNetwork) {
            this.pending = this.pending.filter((p) => p !== entry);
            this.failed.push({ label: entry.label, error: err.message, at: Date.now() });
            this.changed();
          } else {
            entry.attempts++;
            entry.lastError = err instanceof Error ? err.message : String(err);
            this.changed();
            break;
          }
        }
      }
    } finally {
      this.flushing = false;
      if (this.pending.length > 0) this.schedule();
    }
  }

  dismissFailed() {
    this.failed = [];
    this.changed();
  }
}

export const outbox = new Outbox();

export function useOutbox() {
  return useSyncExternalStore(outbox.subscribe, outbox.getSnapshot);
}
