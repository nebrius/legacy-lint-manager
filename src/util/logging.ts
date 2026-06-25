/* eslint-disable no-console */
let verboseEnabled = false;
export function setVerbose(verbose: boolean) {
  verboseEnabled = verbose;
}

export function error(msg: string) {
  console.error(msg);
}

export function info(msg: string) {
  console.info(msg);
}

function debug(msg: string) {
  if (verboseEnabled) {
    console.debug(`[Debug]: ${msg}`);
  }
}

export function time<T>(label: string, cb: () => T): T {
  debug(`Started ${label}`);
  const start = performance.now();
  const result = cb();
  if (result instanceof Promise) {
    void result.then(() => {
      const end = performance.now();
      const roundedDuration = Math.round((end - start) * 10) / 10;
      debug(`${label}: ${roundedDuration.toLocaleString()}ms`);
    });
  } else {
    const end = performance.now();
    const roundedDuration = Math.round((end - start) * 10) / 10;
    debug(`Finished ${label}: ${roundedDuration.toLocaleString()}ms`);
  }
  return result;
}
