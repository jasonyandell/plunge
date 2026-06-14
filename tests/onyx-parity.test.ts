/**
 * STRICT golden-parity gate for the onyx player (issue: in-browser belief
 * student). For every golden state emitted by mk5-main's export_onyx.py:
 *
 *   1. The TS featurizer (src/ai/onyx-features.ts), driven from the
 *      plunge-reproducible spec, produces tokens/attn/voids/bids BYTE-IDENTICAL
 *      to the Python tensors recorded in golden.json.
 *   2. onnxruntime-web, fed those tensors, produces pi_me_logits matching the
 *      Python (torch) logits within 1e-4 — and belief_logits within 1e-4.
 *
 * This is THE gate on cross-language featurization. If it fails, the
 * featurization is wrong — fix the featurizer, never loosen the tolerance.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as ort from 'onnxruntime-web';
import {
  type DomPlay,
  type FeatureInput,
  buildTensors,
  idToDomId,
} from '../src/ai/onyx-features';

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(
  readFileSync(join(here, 'fixtures', 'onyx_golden.json'), 'utf8'),
) as GoldenFile;
const ONNX_PATH = join(here, 'fixtures', 'onyx.onnx');

interface GoldenState {
  name: string;
  hands: string[][];
  decl_id: number;
  current_player: number;
  plays: [number, string][];
  bids_raw: number[] | null;
  high_bidder: number;
  high_bid: number;
  cp_initial_hand: string[];
  cp_played: string[];
  tokens: number[][]; // [33][5]
  attn: boolean[]; // [33]
  voids: number[]; // [24]
  bids: number[]; // [28]
  pi_me_logits: number[]; // [7]
  belief_logits: number[][]; // [28][3]
}
interface GoldenFile {
  n_states: number;
  states: GoldenState[];
}

/** Rebuild the canonical FeatureInput from a golden state's plunge spec. */
function inputFromGolden(s: GoldenState): FeatureInput {
  const hands = s.hands.map((h) => h.map(idToDomId));
  const plays: DomPlay[] = s.plays.map(([seat, id]) => ({
    seat,
    domId: idToDomId(id),
  }));
  return { hands, declId: s.decl_id, plays, cp: s.current_player };
}

describe('onyx golden featurizer parity (Python <-> TS)', () => {
  it('has golden states', () => {
    expect(golden.n_states).toBeGreaterThan(0);
    expect(golden.states.length).toBe(golden.n_states);
  });

  for (const s of golden.states) {
    it(`featurizes "${s.name}" byte-identically to Python`, () => {
      const input = inputFromGolden(s);
      const t = buildTensors(
        input,
        s.bids_raw,
        s.bids_raw === null ? null : s.high_bidder,
        s.bids_raw === null ? null : s.high_bid,
      );

      // tokens [33][5] flattened position-major
      const expTokens = s.tokens.flat();
      expect(Array.from(t.tokens)).toEqual(expTokens);

      // attn [33]
      expect(Array.from(t.attn)).toEqual(s.attn.map((b) => (b ? 1 : 0)));

      // voids [24] — exact (only 0.0/1.0 values)
      expect(Array.from(t.voids)).toEqual(s.voids);

      // bids [28] — within tight float tol (bidNorm is a ratio)
      expect(t.bids.length).toBe(28);
      for (let i = 0; i < 28; i++) {
        expect(t.bids[i]!).toBeCloseTo(s.bids[i]!, 6);
      }
    });
  }
});

describe('onyx ONNX inference parity (onnxruntime-web <-> torch)', () => {
  let session: ort.InferenceSession;

  beforeAll(async () => {
    const bytes = readFileSync(ONNX_PATH);
    session = await ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
    });
  }, 60_000);

  for (const s of golden.states) {
    it(`pi_me/belief match torch for "${s.name}" within 1e-4`, async () => {
      const input = inputFromGolden(s);
      const t = buildTensors(
        input,
        s.bids_raw,
        s.bids_raw === null ? null : s.high_bidder,
        s.bids_raw === null ? null : s.high_bid,
      );

      const tokens = new ort.Tensor(
        'int64',
        BigInt64Array.from(Array.from(t.tokens, (x) => BigInt(x))),
        [1, 33, 5],
      );
      const attn = new ort.Tensor(
        'bool',
        Uint8Array.from(t.attn),
        [1, 33],
      );
      const world = new ort.Tensor('float32', new Float32Array(28 * 3), [1, 28, 3]);
      const voids = new ort.Tensor('float32', t.voids, [1, 24]);
      const bids = new ort.Tensor('float32', t.bids, [1, 28]);

      const out = await session.run({ tokens, attn, world, voids, bids });
      const pi = out['pi_me_logits']!.data as Float32Array;
      const bel = out['belief_logits']!.data as Float32Array;

      for (let i = 0; i < 7; i++) {
        expect(pi[i]!).toBeCloseTo(s.pi_me_logits[i]!, 4);
      }
      // belief_logits [28][3] flattened
      const expBel = s.belief_logits.flat();
      for (let i = 0; i < expBel.length; i++) {
        expect(bel[i]!).toBeCloseTo(expBel[i]!, 4);
      }
    }, 30_000);
  }
});
