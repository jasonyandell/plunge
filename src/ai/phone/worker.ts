/** Synchronous Rust runs only here. Host imports carry time and checkpoints,
 * never game state, hidden hands, or policy decisions. */
import wasmUrl from './walt-player.wasm?url';

interface Exports {
  memory: WebAssembly.Memory;
  walt_in_prepare(n: number): number;
  walt_call(): number;
  walt_out_ptr(): number;
}
const ctx = self as unknown as { onmessage: (e: MessageEvent) => void; postMessage(value: unknown): void };
const decoder = new TextDecoder();
ctx.onmessage = async ({ data }: MessageEvent) => {
  try {
    let exports: Exports;
    const bytes = await (await fetch(wasmUrl)).arrayBuffer();
    const loaded = await WebAssembly.instantiate(bytes, { walt_host: {
      now_us: () => BigInt(Math.floor(performance.now() * 1000)),
      checkpoint: (ptr: number, len: number) => {
        const value = JSON.parse(decoder.decode(new Uint8Array(exports.memory.buffer, ptr, len))) as unknown;
        ctx.postMessage({ checkpoint: value });
      },
    } });
    exports = loaded.instance.exports as unknown as Exports;
    const input = new TextEncoder().encode(JSON.stringify(data));
    const ptr = exports.walt_in_prepare(input.length);
    new Uint8Array(exports.memory.buffer, ptr, input.length).set(input);
    const len = exports.walt_call();
    const result = JSON.parse(decoder.decode(new Uint8Array(exports.memory.buffer, exports.walt_out_ptr(), len))) as unknown;
    ctx.postMessage({ result });
  } catch (error) { ctx.postMessage({ error: String(error) }); }
};
