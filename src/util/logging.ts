// export function warn(msg: string) {
//   console.warn(`[Warn]: ${msg}`);
// }

let verboseEnabled = false;
export function setVerbose(verbose: boolean) {
  verboseEnabled = verbose;
}

export function debug(msg: string) {
  if (verboseEnabled) {
    console.debug(`[Debug]: ${msg}`);
  }
}

export function time<T>(label: string, cb: () => T): T {
  const start = performance.now();
  const result = cb();
  const end = performance.now();
  const roundedDuration = Math.round((end - start) * 10) / 10;
  debug(`${label}: ${roundedDuration.toLocaleString()}ms`);
  return result;
}
