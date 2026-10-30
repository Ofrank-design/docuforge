export interface Logger {
  info(message: string): void;
  verbose(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  success(message: string): void;
}

export interface LoggerOptions {
  verbose: boolean;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  color?: boolean;
}

export function createLogger(opts: LoggerOptions): Logger {
  const out = opts.stdout ?? process.stdout;
  const err = opts.stderr ?? process.stderr;
  const color = opts.color ?? (Boolean((out as NodeJS.WriteStream).isTTY) && !process.env["NO_COLOR"]);
  const paint = (code: number, s: string): string => (color ? `\u001b[${code}m${s}\u001b[0m` : s);
  // File names and YAML error text come from untrusted sources; never let them
  // inject terminal escape sequences.
  const clean = (s: string): string => s.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "?");

  return {
    info: (m) => void out.write(`${clean(m)}\n`),
    verbose: (m) => {
      if (opts.verbose) out.write(`${paint(90, clean(m))}\n`);
    },
    warn: (m) => void err.write(`${paint(33, "warning")} ${clean(m)}\n`),
    error: (m) => void err.write(`${paint(31, "error")} ${clean(m)}\n`),
    success: (m) => void out.write(`${paint(32, "✔")} ${clean(m)}\n`),
  };
}

export function createSilentLogger(): Logger {
  const noop = (): void => {};
  return { info: noop, verbose: noop, warn: noop, error: noop, success: noop };
}
