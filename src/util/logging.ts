export function warn(msg: string) {
  console.warn(`[Warn]: ${msg}`);
}

let verboseEnabled = false;
export function setVerbose(verbose: boolean) {
  verboseEnabled = verbose;
}

export function debug(msg: string) {
  if (verboseEnabled) {
    console.debug(`[Debug]: ${msg}`);
  }
}
