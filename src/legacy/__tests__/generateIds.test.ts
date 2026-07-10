import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeId } from '../../__tests__/helpers/ids.js';
import { ID_LENGTH } from '../../util/constants.js';
import { generateId } from '../generateIds.js';

// generateId is now a thin wrapper: it hands back a supplied previous id
// unchanged, or mints a fresh one from nanoid. nanoid is mocked so the fresh
// value is deterministic and so we can assert exactly when (and with what size)
// it is consumed. There is no longer any module-level id registry or collision
// dedupe, so no per-test module reset is needed.
const nanoidMock = vi.fn<(size?: number) => string>();
vi.mock('nanoid', () => ({ nanoid: (size?: number) => nanoidMock(size) }));

beforeEach(() => {
  nanoidMock.mockReset();
});

describe('generateId', () => {
  it('mints a fresh nanoid of the configured length when no previous id is supplied', () => {
    nanoidMock.mockReturnValue(makeId('fresh'));
    expect(generateId()).toBe(makeId('fresh'));
    // The fresh id must be requested at the configured width so ids stay
    // collision-resistant as ID_LENGTH changes.
    expect(nanoidMock).toHaveBeenCalledWith(ID_LENGTH);
  });

  it('returns the supplied previous id without consuming nanoid', () => {
    expect(generateId(makeId('reused'))).toBe(makeId('reused'));
    expect(nanoidMock).not.toHaveBeenCalled();
  });

  it('generates a distinct id on each call when no previous id is supplied', () => {
    nanoidMock
      .mockReturnValueOnce(makeId('first'))
      .mockReturnValueOnce(makeId('second'));
    expect(generateId()).toBe(makeId('first'));
    expect(generateId()).toBe(makeId('second'));
    expect(nanoidMock).toHaveBeenCalledTimes(2);
  });
});
