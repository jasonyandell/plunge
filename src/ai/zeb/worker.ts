import init, { forecast, play, version, netId } from '@jasonyandell/zeb';
import wasm from '@jasonyandell/zeb/zeb_bg.wasm?url';
import type { ZebCall } from './client';

const ready = init({ module_or_path: wasm });
self.onmessage = async ({ data: call }: MessageEvent<ZebCall>) => {
  try {
    await ready;
    const start = performance.now();
    const value = call.kind === 'forecast' ? forecast(call.request) : play(call.request);
    self.postMessage({ result: { value, version: version(), net: netId(), elapsed_us: Math.round((performance.now() - start) * 1000) } });
  } catch (error) { self.postMessage({ error: String(error) }); }
};
