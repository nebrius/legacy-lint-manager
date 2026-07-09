import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeId } from '../../__tests__/helpers/ids.js';

// generateIds.ts holds a module-level Map that persists for the lifetime of the
// module. Each test resets the module registry and re-imports so it starts with
// a fresh, empty map — otherwise ids would leak between cases. nanoid is
// mocked so the generated values (and a deliberate collision) are deterministic.
const nanoidMock = vi.fn<() => string>();
vi.mock('nanoid', () => ({ nanoid: () => nanoidMock() }));

async function loadModule() {
  vi.resetModules();
  return import('../generateIds.js');
}

beforeEach(() => {
  nanoidMock.mockReset();
});

describe('generateId', () => {
  it('returns a freshly generated id when no previous id is supplied', async () => {
    nanoidMock.mockReturnValue(makeId('fresh'));
    const { generateId } = await loadModule();
    expect(generateId({ rules: ['no-console'] })).toBe(makeId('fresh'));
  });

  it('reuses a supplied previous id without consuming nanoid', async () => {
    const { generateId } = await loadModule();
    expect(
      generateId({ previousId: makeId('reused'), rules: ['no-console'] })
    ).toBe(makeId('reused'));
    expect(nanoidMock).not.toHaveBeenCalled();
  });

  it('regenerates when the first generated id collides with an existing one', async () => {
    // First call takes the "collide" id. The second call's first nanoid result
    // repeats it, forcing the dedupe loop to spin again and take the "unique" id.
    nanoidMock
      .mockReturnValueOnce(makeId('collide'))
      .mockReturnValueOnce(makeId('collide'))
      .mockReturnValueOnce(makeId('unique'));
    const { generateId } = await loadModule();
    expect(generateId({ rules: ['no-console'] })).toBe(makeId('collide'));
    expect(generateId({ rules: ['no-debugger'] })).toBe(makeId('unique'));
    expect(nanoidMock).toHaveBeenCalledTimes(3);
  });

  it('regenerates when a supplied previous id collides with an already-used id', async () => {
    nanoidMock.mockReturnValueOnce(makeId('regen'));
    const { generateId } = await loadModule();
    // The "dupe" id is claimed first as a fresh previous id.
    expect(
      generateId({ previousId: makeId('dupe'), rules: ['no-console'] })
    ).toBe(makeId('dupe'));
    // Supplying the same previous id again collides, so it falls through to a
    // freshly generated value rather than handing back a duplicate.
    expect(
      generateId({ previousId: makeId('dupe'), rules: ['no-debugger'] })
    ).toBe(makeId('regen'));
  });

  it('stores the supplied rules against the generated id', async () => {
    const { generateId, getIds } = await loadModule();
    const id = generateId({
      previousId: makeId('withrule'),
      rules: ['no-console', 'no-debugger'],
    });
    expect(getIds().get(id)).toEqual(['no-console', 'no-debugger']);
  });
});

describe('getIds', () => {
  it('returns an empty map before any ids are generated', async () => {
    const { getIds } = await loadModule();
    expect(getIds()).toEqual(new Map());
  });

  it('returns every generated id mapped to its rules', async () => {
    const { generateId, getIds } = await loadModule();
    generateId({ previousId: makeId('m'), rules: ['no-console'] });
    generateId({ previousId: makeId('a'), rules: ['no-debugger'] });
    generateId({ previousId: makeId('z'), rules: ['no-var'] });
    expect(getIds()).toEqual(
      new Map([
        [makeId('m'), ['no-console']],
        [makeId('a'), ['no-debugger']],
        [makeId('z'), ['no-var']],
      ])
    );
  });
});
