/* v8 ignore start */
export class InternalError extends Error {
  constructor(
    message: string,
    sourceDetails?: { file: string; line?: number }
  ) {
    let formattedMessage = `Internal error: ${message}. This is a bug, please report the message and the stack trace to the maintainer at https://github.com/nebrius/legacy-lint-manager/issues`;
    if (sourceDetails) {
      if (sourceDetails.line) {
        formattedMessage += `\n\nIn ${sourceDetails.file}:${sourceDetails.line.toString()}\n`;
      } else {
        formattedMessage += `\n\nIn ${sourceDetails.file}\n`;
      }
    }
    super(formattedMessage);
  }
}
/* v8 ignore end */
