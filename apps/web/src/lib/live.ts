import type { WsMessage } from '@bestellsystem/shared';
import { useEffect, useRef, useSyncExternalStore } from 'react';

type Listener = (msg: WsMessage) => void;
type ReconnectListener = () => void;

/**
 * Eine WebSocket-Verbindung pro Gerät für Live-Updates. Baut sich nach
 * WLAN-Aussetzern selbst wieder auf und meldet das, damit Seiten neu laden.
 */
class LiveConnection {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectListeners = new Set<ReconnectListener>();
  private statusListeners = new Set<() => void>();
  private delay = 1000;
  private wanted = false;
  private hadConnection = false;
  private timer: number | null = null;
  connected = false;

  start() {
    if (this.wanted) return;
    this.wanted = true;
    this.open();
  }

  stop() {
    this.wanted = false;
    if (this.timer) window.clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
  }

  restart() {
    this.stop();
    this.start();
  }

  private setConnected(value: boolean) {
    this.connected = value;
    for (const l of this.statusListeners) l();
  }

  private open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.delay = 1000;
      this.setConnected(true);
      if (this.hadConnection) for (const l of this.reconnectListeners) l();
      this.hadConnection = true;
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        for (const l of this.listeners) l(msg);
      } catch {
        // ignorieren
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setConnected(false);
      if (!this.wanted) return;
      this.timer = window.setTimeout(() => this.open(), this.delay);
      this.delay = Math.min(10_000, this.delay * 2);
    };
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onReconnect(listener: ReconnectListener) {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  }

  subscribeStatus = (listener: () => void) => {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  };
}

export const live = new LiveConnection();

/** Reagiert auf Live-Nachrichten; `onReconnect` lädt nach Verbindungsabbruch neu. */
export function useLive(handler: Listener, onReconnect?: () => void) {
  const handlerRef = useRef(handler);
  const reconnectRef = useRef(onReconnect);
  handlerRef.current = handler;
  reconnectRef.current = onReconnect;
  useEffect(() => {
    const off1 = live.subscribe((m) => handlerRef.current(m));
    const off2 = live.onReconnect(() => reconnectRef.current?.());
    return () => {
      off1();
      off2();
    };
  }, []);
}

export function useLiveStatus() {
  return useSyncExternalStore(live.subscribeStatus, () => live.connected);
}
