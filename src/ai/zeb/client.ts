import type { Forecast, ForecastRequest, Move, PositionRequest } from '@jasonyandell/zeb';

export type ZebCall = { kind: 'forecast'; request: ForecastRequest } | { kind: 'play'; request: PositionRequest };
export interface ZebResult<T> { value: T; version: string; net: string; elapsed_us: number }
export type ZebForecast = ZebResult<Forecast[]>;
export type ZebPlay = ZebResult<Move>;

/** One computation per worker. Cancellation releases the synchronous WASM and its memory. */
export function runZeb(call: ZebCall, signal?: AbortSignal): Promise<ZebForecast | ZebPlay> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Stopped', 'AbortError')); return; }
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const finish = (result?: ZebForecast | ZebPlay, error?: unknown) => {
      clearTimeout(timer); worker.terminate(); signal?.removeEventListener('abort', abort);
      if (result) resolve(result); else reject(error);
    };
    const abort = () => finish(undefined, new DOMException('Stopped', 'AbortError'));
    const timer = setTimeout(() => finish(undefined, new Error('Zeb took too long. Please retry.')), 30000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = event => { event.preventDefault(); finish(undefined, new Error(event.message)); };
    worker.onmessage = ({ data }) => data.error ? finish(undefined, new Error(data.error)) : finish(data.result);
    worker.postMessage(call);
  });
}
