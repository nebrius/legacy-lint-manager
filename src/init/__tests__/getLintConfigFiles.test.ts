import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getLintConfigFiles } from '../getLintConfigFiles.js';

const PROJECT_ROOT = join(import.meta.dirname, 'project');

function find(scenario: string) {
  return getLintConfigFiles(join(PROJECT_ROOT, scenario));
}

function paths(scenario: string, files: string[]): string[] {
  return files.map((file) => join(PROJECT_ROOT, scenario, file));
}

describe('getLintConfigFiles', () => {
  it('detects an ESLint config and reports no Oxlint config', () => {
    const result = find('eslint-only');
    expect(result.eslint).toEqual(paths('eslint-only', ['eslint.config.mjs']));
    expect(result.oxlint).toEqual([]);
  });

  it('detects an Oxlint config and reports no ESLint config', () => {
    const result = find('oxlint-only');
    expect(result.eslint).toEqual([]);
    expect(result.oxlint).toEqual(paths('oxlint-only', ['.oxlintrc.json']));
  });

  it('detects both linters when both config files are present', () => {
    const result = find('both');
    expect(result.eslint).toEqual(paths('both', ['eslint.config.js']));
    expect(result.oxlint).toEqual(paths('both', ['.oxlintrc.json']));
  });

  it('returns every recognized ESLint config variant present', () => {
    const result = find('multiple-eslint');
    expect(result.eslint.sort()).toEqual(
      paths('multiple-eslint', ['eslint.config.js', 'eslint.config.mjs']).sort()
    );
  });

  it('ignores files whose names are not recognized linter configs', () => {
    // The directory holds package.json and .eslintrc.json, neither of which is
    // a flat-config or Oxlint config file.
    expect(find('non-matching')).toEqual({ eslint: [], oxlint: [] });
  });

  it('returns absolute paths rooted at the search directory, not bare names', () => {
    const expected = join(PROJECT_ROOT, 'eslint-only', 'eslint.config.mjs');
    expect(find('eslint-only').eslint).toEqual([expected]);
  });
});
