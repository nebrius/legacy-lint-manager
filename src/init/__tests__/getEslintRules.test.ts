import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getEslintRules } from '../getEslintRules.js';

const CONFIG_ROOT = join(import.meta.dirname, 'project', 'eslint-configs');

// getEslintRules dynamically imports the config by absolute path, so the
// fixtures are real importable flat-config modules.
function rulesFrom(fixture: string): Promise<string[]> {
  return getEslintRules(join(CONFIG_ROOT, fixture));
}

describe('getEslintRules', () => {
  it('returns the rule names declared in a single config object', async () => {
    const rules = await rulesFrom('single.mjs');
    expect(rules.sort()).toEqual(['eqeqeq', 'no-console']);
  });

  it('merges rule names across config objects without duplicates', async () => {
    const rules = await rulesFrom('multiple.mjs');
    expect(rules.sort()).toEqual(['eqeqeq', 'no-console', 'no-debugger']);
  });

  it('skips config objects that declare no rules', async () => {
    await expect(rulesFrom('no-rules.mjs')).resolves.toEqual([]);
  });

  it('returns an empty list for an empty config array', async () => {
    await expect(rulesFrom('empty.mjs')).resolves.toEqual([]);
  });
});
