import { beforeEach, describe, expect, it, vi } from 'vitest';

// generateIds.ts holds a module-level Set that persists for the lifetime of the
// module. Each test resets the module registry and re-imports so it starts with
// a fresh, empty idSet — otherwise ids would leak between cases. nanoid is
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
    expect(generateId()).toBe('fresh001');
  });

  it('reuses a supplied previous id without consuming nanoid', async () => {
    const { generateId } = await loadModule();
    expect(generateId('reused01')).toBe('reused01');
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
    expect(generateId()).toBe('collide0');
    expect(generateId()).toBe('unique02');
    expect(nanoidMock).toHaveBeenCalledTimes(3);
  });

  it('regenerates when a supplied previous id collides with an already-used id', async () => {
    nanoidMock.mockReturnValueOnce('regen001');
    const { generateId } = await loadModule();
    // "dupe0001" is claimed first as a fresh previous id.
    expect(generateId('dupe0001')).toBe('dupe0001');
    // Supplying the same previous id again collides, so it falls through to a
    // freshly generated value rather than handing back a duplicate.
    expect(generateId('dupe0001')).toBe('regen001');
  });
});

describe('getIds', () => {
  it('returns an empty array before any ids are generated', async () => {
    const { getIds } = await loadModule();
    expect(getIds()).toEqual([]);
  });

  it('returns every generated id, sorted', async () => {
    const { generateId, getIds } = await loadModule();
    generateId('m0000000');
    generateId('a0000000');
    generateId('z0000000');
    expect(getIds()).toEqual(['a0000000', 'm0000000', 'z0000000']);
  });
});
