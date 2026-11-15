export type LogFields = Record<string, string | number | boolean | null>

/** Where the app writes what happened; one JSON object per line. */
export interface Logger {
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
}

function write(
  stream: 'log' | 'error',
  level: string,
  message: string,
  fields: LogFields,
): void {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...fields,
  })
  if (stream === 'error') console.error(line)
  else console.log(line)
}

export const consoleLogger: Logger = {
  info: (message, fields = {}) => write('log', 'info', message, fields),
  warn: (message, fields = {}) => write('log', 'warn', message, fields),
  error: (message, fields = {}) => write('error', 'error', message, fields),
}

/** A logger that remembers its lines, for tests. */
export class MemoryLogger implements Logger {
  readonly lines: Array<{ level: string; message: string; fields: LogFields }> =
    []

  info(message: string, fields: LogFields = {}): void {
    this.lines.push({ level: 'info', message, fields })
  }

  warn(message: string, fields: LogFields = {}): void {
    this.lines.push({ level: 'warn', message, fields })
  }

  error(message: string, fields: LogFields = {}): void {
    this.lines.push({ level: 'error', message, fields })
  }
}
