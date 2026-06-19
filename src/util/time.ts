import { debug } from './logging.js';

export function time<T>(label: string, cb: () => T): T {
  const start = performance.now();
  const result = cb();
  const end = performance.now();
  const roundedDuration = Math.round((end - start) * 10) / 10;
  debug(`${label}: ${roundedDuration.toLocaleString()}ms`);
  return result;
}
