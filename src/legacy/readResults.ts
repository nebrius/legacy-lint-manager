import { spawn } from 'node:child_process';

import type { Config } from '../util/config.js';

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

    commandProcess.on('error', (error) => {
      reject(error);
    });

    commandProcess.on('close', (code) => {
      if (linterType === 'eslint') {
        switch (code) {
          case 0:
          case 1: {
            try {
              resolve(JSON.parse(results.join('')));
            } catch (error) {
              // There are several systems fighting here over what the correct
              // type and type assertions are. This type is always an Error, but
              // TypeScript always types caught errors as `unknown`, but for some
              // reason the linter still thinks the cast is unecessary.
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
              reject(error as Error);
            }
            break;
          }
          default: {
            reject(
              new Error(
                errorOutput.join('\n') ||
                  'ESLint did not run successfully' +
                    (code ? ` and exited with code ${code.toString()}` : '')
              )
            );
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
        } catch (error) {
          // There are several systems fighting here over what the correct
          // type and type assertions are. This type is always an Error, but
          // TypeScript always types caught errors as `unknown`, but for some
          // reason the linter still thinks the cast is unecessary.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
          reject(error as Error);
        }
      }
    });
  });
}
