import { spawn } from 'node:child_process';

import type { Config } from '../util/config.js';
import { error } from '../util/logging.js';

export async function readResults({
  linterType,
  lintCommand,
  dir,
}: {
  linterType: Config['linterType'];
  lintCommand: Config['lintCommand'];
  dir: string;
}) {
  /* v8 ignore start */
  if (process.platform === 'win32') {
    throw new Error('legacy-errors is not supported on Windows outside of WSL');
  }
  /* v8 ignore end */
  return new Promise<unknown>((resolve, reject) => {
    const commandProcess = spawn(lintCommand.command, lintCommand.args, {
      cwd: dir,
    });

    const results: string[] = [];
    commandProcess.stdout.setEncoding('utf-8');
    commandProcess.stdout.on('data', (data: string) => {
      results.push(data);
    });

    const errorOutput: string[] = [];
    commandProcess.stderr.setEncoding('utf-8');
    commandProcess.stderr.on('data', (data: string) => {
      errorOutput.push(data);
    });

    commandProcess.on('error', (err) => {
      reject(err);
    });

    function exitWithParseError({
      err,
      preamble,
    }: {
      err?: Error;
      preamble?: string;
    }) {
      error(
        preamble ??
          'Could not JSON parse linter output. Did you forget `--format=json` in your lintCommand?'
      );
      if (err) {
        error('\n\n--- Error ---\n\n');
        error(err.toString());
      }
      if (errorOutput.length > 0) {
        error(`\n\n--- ${linterType} stderr ---\n\n`);
        error(errorOutput.join(''));
      }
      if (results.length > 0) {
        const stdout = results.join('');
        if (stdout.length > 1_024) {
          error(`\n\n--- ${linterType} stdout (last 1kb only) ---\n\n`);
          error(stdout.slice(stdout.length - 1_024));
        } else {
          error(`\n\n--- ${linterType} stdout ---\n\n`);
          error(stdout);
        }
      }
      process.exit(1);
    }

    commandProcess.on('close', (code) => {
      if (linterType === 'eslint') {
        switch (code) {
          case 0:
          case 1: {
            try {
              resolve(JSON.parse(results.join('')));
            } catch (err) {
              exitWithParseError({ err: err as Error });
            }
            break;
          }
          default: {
            exitWithParseError({
              preamble:
                'ESLint did not run successfully' +
                (code ? ` and exited with code ${code.toString()}` : ''),
            });
            break;
          }
        }
      } else {
        // Oxlint doesn't have useful exit codes, with 0 for "no errors found"
        // and 1 for "any sort of problem at all occured". It might be that lint
        // errors were found, but it could also mean "your Oxlint config is
        // invalid". Which is to say it doesn't say anything useful. As such,
        // all we can do is try to parse the output and see if it's valid JSON,
        // otherwise we consider it a failure.
        try {
          resolve(JSON.parse(results.join('')));
        } catch (err) {
          exitWithParseError({ err: err as Error });
        }
      }
    });
  });
}
