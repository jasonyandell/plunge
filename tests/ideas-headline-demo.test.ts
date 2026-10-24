import { expect, it } from 'vitest';
import { headlineExamples, isHeadlineDemo } from '../src/ideas/headline-demo';
import { ideaPresentation } from '../src/ideas/presentation';

it('opens story 34 directly at its preview root, but keeps normal app links intact', ()=>{
  const preview = 'https://plunge-pr-86.texas42.workers.dev';
  expect(isHeadlineDemo(new URL(preview), true)).toBe(true);
  expect(isHeadlineDemo(new URL(preview), false)).toBe(false);
  for (const path of ['/?play=1', '/?ideas=1', '/?account=1', '/?stats=1', '/#room=abc', '/#hand=abc', '/other']) {
    expect(isHeadlineDemo(new URL(path, preview), true)).toBe(false);
  }
  for (const origin of ['https://plunge.texas42.workers.dev', 'https://plunge-pr-87.texas42.workers.dev', 'http://localhost:5173']) {
    expect(isHeadlineDemo(new URL(origin), true)).toBe(false);
    expect(isHeadlineDemo(new URL('/?ideas=1&demo=headlines', origin), false)).toBe(true);
  }
  expect(isHeadlineDemo(new URL('/?account=1&ideas=1&demo=headlines', preview), true)).toBe(false);
});

it('uses the real card formatter for examples adapted from other stories', ()=>{
  expect(headlineExamples.map(example=>ideaPresentation({title:example.request,number:34}).title)).toEqual([
    'Slugs: headline summaries for titles',
    'Name the high bidder in the bidding prompt',
    'Review completed hands from the current solo or family game',
    'Pause between hands until everyone is ready',
  ]);
});
