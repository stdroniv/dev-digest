/**
 * stderr-only logger.
 *
 * CRITICAL: stdout is the JSON-RPC channel for the stdio transport. A single
 * stray byte on stdout corrupts the protocol stream, so NOTHING in this package
 * may write to stdout — no `console.log`, ever. Every diagnostic goes to stderr.
 *
 * Shape matches the `Logger` type the server's review pipeline expects
 * (`server/src/modules/reviews/run-executor.ts` — pino-compatible `(obj, msg)`),
 * so it can be injected straight into `ReviewService.runReview(...)` and the
 * services' own logs stay off stdout.
 */
export interface Logger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
}

type Level = 'info' | 'warn' | 'error' | 'debug';

function line(level: Level, obj: unknown, msg?: string): string {
  const time = new Date().toISOString();
  // pino-compatible call shapes: (msg), (obj), or (obj, msg).
  let detail: string;
  if (typeof obj === 'string' && msg === undefined) {
    detail = obj;
  } else {
    let serialized: string;
    try {
      serialized = JSON.stringify(obj);
    } catch {
      serialized = String(obj);
    }
    detail = msg ? `${msg} ${serialized}` : serialized;
  }
  return `[${time}] ${level.toUpperCase()} ${detail}`;
}

function write(level: Level, obj: unknown, msg?: string): void {
  // console.error writes to stderr (fd 2), never stdout. Use it explicitly so
  // the JSON-RPC stdout channel is never touched.
  console.error(line(level, obj, msg));
}

/** A stderr-only Logger. Safe to inject into the server's review services. */
export const stderrLogger: Logger = {
  info: (obj, msg) => write('info', obj, msg),
  warn: (obj, msg) => write('warn', obj, msg),
  error: (obj, msg) => write('error', obj, msg),
  debug: (obj, msg) => write('debug', obj, msg),
};
