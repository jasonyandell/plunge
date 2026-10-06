import type { RoomCommand, RoomCredentials, RoomMessage, RoomState } from './protocol';

export const ROOMS_ENABLED = typeof __ROOMS_ENABLED__ !== 'undefined' && __ROOMS_ENABLED__;
const KEY = 'plunge:room:';
export function roomFromHash(hash: string): string | null {
  return /^#room=([a-f0-9]{32,64})$/.exec(hash)?.[1] ?? null;
}
export function savedSeat(roomId: string, storage: Storage): RoomCredentials | null {
  try {
    const value = JSON.parse(storage.getItem(KEY + roomId) ?? 'null') as RoomCredentials | null;
    return value && value.roomId === roomId && /^[a-f0-9]{32,64}$/.test(value.token)
      && [0, 1, 2, 3].includes(value.seat) ? value : null;
  } catch { return null; }
}
export function saveSeat(seat: RoomCredentials, storage: Storage): void {
  storage.setItem(KEY + seat.roomId, JSON.stringify(seat));
}
export async function enterRoom(name: string, roomId?: string): Promise<RoomCredentials> {
  const response = await fetch(roomId ? `/api/rooms/${roomId}/join` : '/api/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  const body = await response.json() as RoomCredentials & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Could not open the room. Try again.');
  return body;
}

/** Only server snapshots change the game. An uncertain tap retains its id on reconnect. */
export class RoomConnection {
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private lastPong = 0;
  private attempts = 0;
  private pending = new Map<string, RoomCommand>();
  private acknowledgements = new Map<string, number>();
  private seenRevision = -1;
  constructor(private credentials: RoomCredentials, private handlers: {
    state: (state: RoomState) => void; status: (connected: boolean) => void;
    error: (message: string) => void; pending: (pending: boolean) => void;
  }) { this.connect(); }
  private connect(): void {
    if (this.stopped) return;
    const url = new URL(`/api/rooms/${this.credentials.roomId}/socket`, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', this.credentials.token);
    const socket = this.socket = new WebSocket(url);
    socket.onopen = () => {
      this.attempts = 0; this.lastPong = Date.now();
      // A valid snapshot, rather than the TCP handshake, enables play.
      for (const command of this.pending.values()) socket.send(JSON.stringify(command));
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastPong > 15000) { socket.close(); return; }
        if (socket.readyState === WebSocket.OPEN) socket.send('ping');
      }, 5000);
    };
    socket.onmessage = event => {
      this.lastPong = Date.now();
      if (event.data === 'pong') return;
      try {
        const message = JSON.parse(String(event.data)) as RoomMessage;
        if (message.type === 'state') {
          this.seenRevision = message.revision;
          for (const [id, revision] of this.acknowledgements) if (revision <= message.revision) {
            this.pending.delete(id); this.acknowledgements.delete(id);
          }
          this.handlers.state(message); this.handlers.status(true);
        }
        else if (message.type === 'error') {
          if (message.id) this.pending.delete(message.id);
          this.handlers.error(message.message);
        } else if (message.type === 'ack') {
          if (message.revision <= this.seenRevision) this.pending.delete(message.id);
          else this.acknowledgements.set(message.id, message.revision);
        }
        this.handlers.pending(this.pending.size > 0);
      } catch { this.handlers.error('The room sent an unreadable update. Reconnecting.'); socket.close(); }
    };
    socket.onclose = event => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.handlers.status(false);
      if (event.code === 4001) {
        this.stopped = true;
        this.handlers.error('Your seat is open in another tab. Use that tab, or refresh this one to return here.');
      }
      if (!this.stopped) this.reconnectTimer = setTimeout(() => this.connect(), Math.min(5000, 500 * 2 ** this.attempts++));
    };
    socket.onerror = () => socket.close();
  }
  send(command: RoomCommand): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN || this.stopped) return false;
    if (command.type !== 'thinking') {
      this.pending.set(command.id, command); this.handlers.pending(true);
    }
    this.socket.send(JSON.stringify(command)); return true;
  }
  close(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.socket?.close(); this.socket = null;
  }
}
