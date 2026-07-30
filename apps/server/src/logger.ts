/**
 * Minimal structured logger for the authoritative server. Emits one JSON object
 * per line so logs stay machine-parseable without pulling in a logging library
 * (see docs/DEVELOPMENT_RULES.md on keeping M0 dependencies minimal).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Structured context attached to a log line. Values stay JSON-primitive. */
export interface LogFields {
  readonly [key: string]: string | number | boolean | null;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

// Ordered so a configured level suppresses everything less severe than itself.
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly buildVersion: string;
}

export function createLogger(options: LoggerOptions): Logger {
  const threshold = LEVEL_PRIORITY[options.level];

  const write = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (LEVEL_PRIORITY[level] < threshold) {
      return;
    }
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg: message,
      buildVersion: options.buildVersion,
      ...fields,
    });
    // Errors go to stderr so they survive stdout redirection; everything else to stdout.
    const stream = level === "error" ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
  };

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}
