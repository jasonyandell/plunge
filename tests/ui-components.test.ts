/**
 * Component smoke tests without a DOM (no jsdom in the dep set):
 * preact components are plain functions returning vnodes, so we check
 * aria labels, classes, and structure directly.
 */

import { describe, expect, it } from 'vitest';
import type { VNode } from 'preact';
import { Domino, dominoAriaLabel } from '../src/ui/Domino';
import { Tally } from '../src/ui/Tally';

function props(v: unknown): Record<string, unknown> {
  return (v as VNode).props as unknown as Record<string, unknown>;
}

describe('dominoAriaLabel', () => {
  it('reads pips out loud, counters included', () => {
    expect(dominoAriaLabel('64')).toBe('six-four, worth 10');
    expect(dominoAriaLabel('55')).toBe('double five, worth 10');
    expect(dominoAriaLabel('50')).toBe('five-blank, worth 5');
    expect(dominoAriaLabel('32')).toBe('three-two, worth 5');
    expect(dominoAriaLabel('65')).toBe('six-five');
    expect(dominoAriaLabel('00')).toBe('double blank');
  });
});

describe('<Domino>', () => {
  it('legal + tappable renders a button with an aria-label', () => {
    const v = Domino({ id: '64', state: 'legal', onTap: () => {} }) as VNode;
    expect(v.type).toBe('button');
    const p = props(v);
    expect(p['aria-label']).toBe('six-four, worth 10');
    expect(String(p['class'])).toContain('dom-legal');
    expect(String(p['class'])).toContain('dom-v');
  });

  it('illegal tiles are inert (no button), dimmed class applied', () => {
    const v = Domino({ id: '64', state: 'illegal', onTap: () => {} }) as VNode;
    expect(v.type).toBe('div');
    expect(String(props(v)['class'])).toContain('dom-illegal');
  });

  it('face-down tiles hide their identity', () => {
    const v = Domino({ faceDown: true }) as VNode;
    expect(props(v)['aria-label']).toBe('face-down domino');
  });

  it('horizontal orientation gets the dom-h class', () => {
    const v = Domino({ id: '30', orientation: 'h' }) as VNode;
    expect(String(props(v)['class'])).toContain('dom-h');
  });
});

describe('<Tally> — marks as the word ALL, stroke by stroke', () => {
  function strokes(v: VNode): number {
    const kids = (props(v)['children'] as VNode[]).filter(Boolean);
    const svg = kids.find((k) => (k as VNode).type === 'svg') as VNode;
    const paths = (svg.props as { children?: unknown }).children;
    return Array.isArray(paths) ? paths.length : paths ? 1 : 0;
  }

  it('draws n strokes for n marks, capped at 7 (ALL)', () => {
    expect(strokes(Tally({ marks: 0, label: 'Us' }) as VNode)).toBe(0);
    expect(strokes(Tally({ marks: 3, label: 'Us' }) as VNode)).toBe(3);
    expect(strokes(Tally({ marks: 7, label: 'Us' }) as VNode)).toBe(7);
    expect(strokes(Tally({ marks: 12, label: 'Us' }) as VNode)).toBe(7);
  });

  it('announces the score', () => {
    const v = Tally({ marks: 1, label: 'Them' }) as VNode;
    expect(props(v)['aria-label']).toBe('Them: 1 mark');
  });
});
