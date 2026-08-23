/**
 * walt's Web Worker: walt's calls are synchronous and an opening lead can
 * take seconds, so the solver never runs on the UI thread. Protocol:
 * `{id, kind, req}` in, `{id, resp}` or `{id, error}` out — a load failure
 * answers every request with an error so callers settle (and fall back to
 * hard) instead of hanging.
 */

import { Walt, type BidRequest, type DeclareRequest, type PlayRequest } from './walt';
import wasmUrl from './walt.wasm?url';

export type WaltKind = 'play' | 'bid' | 'declare';

export interface WaltWorkerRequest {
  readonly id: number;
  readonly kind: WaltKind;
  readonly req: PlayRequest | BidRequest | DeclareRequest;
}

export interface WaltWorkerResponse {
  readonly id: number;
  readonly resp?: unknown;
  readonly error?: string;
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(msg: WaltWorkerResponse): void;
};

const waltPromise = Walt.load(fetch(wasmUrl));

ctx.onmessage = async (e: MessageEvent) => {
  const { id, kind, req } = e.data as WaltWorkerRequest;
  try {
    const walt = await waltPromise;
    const resp =
      kind === 'play'
        ? walt.play(req as PlayRequest)
        : kind === 'bid'
          ? walt.bid(req as BidRequest)
          : walt.declare(req as DeclareRequest);
    ctx.postMessage({ id, resp });
  } catch (err) {
    ctx.postMessage({ id, error: String(err) });
  }
};
