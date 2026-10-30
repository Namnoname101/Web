type EventCallback = (payload: any) => void;

class RealtimeClient {
  private socket: WebSocket | null = null;
  private listeners = new Map<string, Set<EventCallback>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isExplicitlyClosed = false;
  private url: string;

  constructor() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = `${protocol}//${window.location.host}/ws`;
  }

  connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isExplicitlyClosed = false;

    try {
      this.socket = new WebSocket(this.url);

      this.socket.onopen = () => {
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.emitLocal('connection:open', {});
      };

      this.socket.onmessage = (event) => {
        try {
          const { event: evtName, payload } = JSON.parse(event.data);
          this.emitLocal(evtName, payload);
        } catch (err) {
          console.error('Failed to parse realtime message', err);
        }
      };

      this.socket.onclose = () => {
        this.emitLocal('connection:close', {});
        this.socket = null;
        if (!this.isExplicitlyClosed) {
          this.scheduleReconnect();
        }
      };

      this.socket.onerror = () => {
        // Will trigger onclose and attempt reconnect
      };
    } catch (e) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isExplicitlyClosed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  send(event: string, payload: any): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ event, payload }));
    } else {
      // Re-attempt connect if dropped
      this.connect();
    }
  }

  on(event: string, callback: EventCallback): () => void {
    let callbacks = this.listeners.get(event);
    if (!callbacks) {
      callbacks = new Set();
      this.listeners.set(event, callbacks);
    }
    callbacks.add(callback);

    // Return unbind function
    return () => {
      const current = this.listeners.get(event);
      if (current) {
        current.delete(callback);
        if (current.size === 0) {
          this.listeners.delete(event);
        }
      }
    };
  }

  private emitLocal(event: string, payload: any): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(payload);
        } catch (err) {
          console.error(`Error in event listener for ${event}`, err);
        }
      }
    }
  }

  disconnect(): void {
    this.isExplicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}

export const realtimeClient = new RealtimeClient();
