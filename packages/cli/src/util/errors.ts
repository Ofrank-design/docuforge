/** Process exit codes used by the CLI. */
export const ExitCode = {
  Ok: 0,
  /** The build ran but produced error-level diagnostics (or strict mode tripped). */
  BuildFailed: 1,
  /** Bad CLI usage or invalid configuration. */
  Usage: 2,
  /** Unexpected internal failure. */
  Internal: 70,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/** An expected, user-facing failure. The message must be actionable. */
export class DocuForgeError extends Error {
  readonly exitCode: ExitCodeValue;

  constructor(message: string, exitCode: ExitCodeValue = ExitCode.Usage) {
    super(message);
    this.name = "DocuForgeError";
    this.exitCode = exitCode;
  }
}
