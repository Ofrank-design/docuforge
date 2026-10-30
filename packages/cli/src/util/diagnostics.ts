export type DiagnosticLevel = "warning" | "error";

export interface Diagnostic {
  level: DiagnosticLevel;
  /** Stable machine-readable code, e.g. `frontmatter.invalid-field`. */
  code: string;
  message: string;
  /** Source file, always relative to the source root (never an absolute path). */
  file?: string;
}

/** Collects warnings and errors produced anywhere in the pipeline. */
export class Diagnostics {
  private readonly items: Diagnostic[] = [];

  warn(code: string, message: string, file?: string): void {
    this.items.push(file === undefined ? { level: "warning", code, message } : { level: "warning", code, message, file });
  }

  error(code: string, message: string, file?: string): void {
    this.items.push(file === undefined ? { level: "error", code, message } : { level: "error", code, message, file });
  }

  /** Record as an error when `strict` is true, otherwise as a warning. */
  report(strict: boolean, code: string, message: string, file?: string): void {
    if (strict) this.error(code, message, file);
    else this.warn(code, message, file);
  }

  get all(): readonly Diagnostic[] {
    return this.items;
  }

  get warnings(): Diagnostic[] {
    return this.items.filter((d) => d.level === "warning");
  }

  get errors(): Diagnostic[] {
    return this.items.filter((d) => d.level === "error");
  }

  get hasErrors(): boolean {
    return this.items.some((d) => d.level === "error");
  }

  /** Deterministic ordering so repeated builds print identical reports. */
  sorted(): Diagnostic[] {
    return [...this.items].sort(
      (a, b) =>
        (a.file ?? "").localeCompare(b.file ?? "") ||
        a.code.localeCompare(b.code) ||
        a.message.localeCompare(b.message),
    );
  }
}
