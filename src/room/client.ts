import type { RoomCommand, RoomCredentials, RoomMessage, RoomState } from './protocol';
import { CLOSE_EXPIRED, CLOSE_OTHER_TAB, CLOSE_SEAT_GONE } from './protocol';

export const ROOMS_ENABLED = typeof __ROOMS_ENABLED__ !== 'undefined' && __ROOMS_ENABLED__;
const KEY = 'plunge:room:';
const LAST = 'plunge:room:last';
export function roomFromHash(hash: string): string | null {
  return /^#room=([a-f0-9]{32,64})$/.exec(hash)?.[1] ?? null;
}
export function roomCode(roomId: string): string { return roomId.match(/.{1,8}/g)?.join('-').toUpperCase() ?? roomId; }
/** Paste a code or a same-origin invite inside the existing installed app. */
export function roomFromInput(value: string, origin: string): string | null {
  const code = value.trim().replace(/[\s-]/g, '').toLowerCase();
  if (/^[a-f0-9]{32}$/.test(code)) return code;
  try {
    const url = new URL(value.trim(), origin);
    return url.origin === origin ? roomFromHash(url.hash) : null;
  } catch { return null; }
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
  storage.setItem(LAST, seat.roomId);
}
export function forgetSeat(roomId: string, storage: Storage): void {
  storage.removeItem(KEY + roomId);
  if (storage.getItem(LAST) === roomId) storage.removeItem(LAST);
}
/** The table this browser sat at most recently, so the home screen can offer it. */
export function lastRoom(storage: Storage): string | null {
  try { const id = storage.getItem(LAST); return id && /^[a-f0-9]{32}$/.test(id) ? id : null; } catch { return null; }
}
export class ClosedTableError extends Error { readonly closed = true; }
export async function enterRoom(name: string, roomId?: string, knock?: string): Promise<RoomCredentials> {
  const response = await fetch(roomId ? `/api/rooms/${roomId}/join` : '/api/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, ...(knock ? { knock } : {}) }),
  });
  const body = await response.json() as RoomCredentials & { error?: string; closed?: boolean };
  if (response.status === 403 && body.closed) throw new ClosedTableError(body.error ?? 'This table is closed.');
  if (!response.ok) throw new Error(body.error ?? 'Could not open the room. Try again.');
  return body;
}
export const newVisitorId = (): string => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');

/** A seat key, or a visitor id for someone knocking at a closed table. */
export type RoomIdentity = RoomCredentials | { roomId: string; visitor: string };
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
  constructor(private identity: RoomIdentity, private handlers: {
    state: (state: RoomState) => void; status: (connected: boolean) => void;
    error: (message: string) => void; pending: (pending: boolean) => void;
    /** The server closed this identity for good: another tab, a seat that is gone, an expired room. */
    ended?: (code: number, reason: string) => void;
  }) { this.connect(); }
  private connect(): void {
    if (this.stopped) return;
    const url = new URL(`/api/rooms/${this.identity.roomId}/socket`, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    if ('token' in this.identity) url.searchParams.set('token', this.identity.token);
    else url.searchParams.set('visitor', this.identity.visitor);
    const socket = this.socket = new WebSocket(url);
    socket.onopen = () => {
      this.attempts = 0; this.lastPong = Date.now();
      // A valid snapshot, rather than the TCP handshake, enables play.
      for (const command of this.pending.values()) socket.send(JSON.stringify(command));
      socket.send('ping');
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
      if ([CLOSE_OTHER_TAB, CLOSE_SEAT_GONE, CLOSE_EXPIRED].includes(event.code)) {
        this.stopped = true;
        if (event.code === CLOSE_OTHER_TAB && !this.handlers.ended)
          this.handlers.error('Your seat is open in another tab. Use that tab, or refresh this one to return here.');
        this.handlers.ended?.(event.code, event.reason);
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
