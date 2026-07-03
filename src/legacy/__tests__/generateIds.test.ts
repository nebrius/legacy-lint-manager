import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    nanoidMock.mockReturnValue('fresh001');
    const { generateId } = await loadModule();
    expect(generateId({ rules: ['no-console'] })).toBe('fresh001');
  });

  it('reuses a supplied previous id without consuming nanoid', async () => {
    const { generateId } = await loadModule();
    expect(generateId({ previousId: 'reused01', rules: ['no-console'] })).toBe(
      'reused01'
    );
    expect(nanoidMock).not.toHaveBeenCalled();
  });

  it('regenerates when the first generated id collides with an existing one', async () => {
    // First call takes "collide0". The second call's first nanoid result
    // repeats it, forcing the dedupe loop to spin again and take "unique02".
    nanoidMock
      .mockReturnValueOnce('collide0')
      .mockReturnValueOnce('collide0')
      .mockReturnValueOnce('unique02');
    const { generateId } = await loadModule();
    expect(generateId({ rules: ['no-console'] })).toBe('collide0');
    expect(generateId({ rules: ['no-debugger'] })).toBe('unique02');
    expect(nanoidMock).toHaveBeenCalledTimes(3);
  });

  it('regenerates when a supplied previous id collides with an already-used id', async () => {
    nanoidMock.mockReturnValueOnce('regen001');
    const { generateId } = await loadModule();
    // "dupe0001" is claimed first as a fresh previous id.
    expect(generateId({ previousId: 'dupe0001', rules: ['no-console'] })).toBe(
      'dupe0001'
    );
    // Supplying the same previous id again collides, so it falls through to a
    // freshly generated value rather than handing back a duplicate.
    expect(generateId({ previousId: 'dupe0001', rules: ['no-debugger'] })).toBe(
      'regen001'
    );
  });

  it('stores the supplied rules against the generated id', async () => {
    const { generateId, getIds } = await loadModule();
    const id = generateId({
      previousId: 'withrule',
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
    generateId({ previousId: 'm0000000', rules: ['no-console'] });
    generateId({ previousId: 'a0000000', rules: ['no-debugger'] });
    generateId({ previousId: 'z0000000', rules: ['no-var'] });
    expect(getIds()).toEqual(
      new Map([
        ['m0000000', ['no-console']],
        ['a0000000', ['no-debugger']],
        ['z0000000', ['no-var']],
      ])
    );
  });
});
