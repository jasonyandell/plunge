import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IDEA_ID } from '../src/ideas/model';
import { hasDemoFor } from '../src/ui/demos';

describe('idea demos', () => {
  it('name each demo file by its own idea card id', () => {
    for (const file of readdirSync(new URL('../src/ui/demos', import.meta.url)))
      if (file !== 'index.tsx') expect(file.replace(/\.tsx$/, '')).toMatch(IDEA_ID);
  });
  it('only open demos that exist, by exact card id', () => {
    expect(hasDemoFor(null)).toBe(false);
    expect(hasDemoFor('index')).toBe(false);
    expect(hasDemoFor('../main')).toBe(false);
    expect(hasDemoFor('0'.repeat(32))).toBe(false);
  });
});
