/**
 * Walt's identity: sha256 over the canonical JSON of the pinned build manifest
 * (src/ai/phone/manifest.json). The manifest names the exact WASM bytes
 * (`wasm_sha256`), the source commit and source hash, the toolchain and the
 * build flags, so the id is a content address: a different build cannot share
 * it, and a local build cannot present itself as a released one without being
 * byte-identical. Computed at build time (vite.config.ts); the Worker computes
 * the same value from the same manifest.
 */
import { NATIVE_TABLE } from './native';

export const WALT_ID: string = typeof __WALT_ID__ !== 'undefined' ? __WALT_ID__ : 'unknown';

/**
 * The Walt that plays the computer seats in this build. The Mac research
 * table runs a separately built native player with no manifest of its own
 * yet, so it is never stamped with the phone build's id.
 */
export const TABLE_WALT: string | null = NATIVE_TABLE ? null : WALT_ID;
