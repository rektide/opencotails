import { sql, type Expression, type SqlBool } from "kysely";

export interface LiteralOptions {
  readonly case?: "sensitive" | "insensitive";
}

export interface RegexOptions {
  readonly flags?: "" | "i";
}

export class InvalidDirectPatternError extends Error {
  public readonly source: string;
  public readonly flags: string;

  public constructor(source: string, flags: string, cause?: unknown) {
    super(`invalid direct regular expression /${source}/${flags}`, { cause });
    this.name = "InvalidDirectPatternError";
    this.source = source;
    this.flags = flags;
  }
}

export function literal(
  text: Expression<string>,
  value: string,
  options: LiteralOptions = {},
): Expression<SqlBool> {
  return options.case === "insensitive"
    ? sql<SqlBool>`instr(lower(${text}), lower(${value})) > 0`
    : sql<SqlBool>`instr(${text}, ${value}) > 0`;
}

export function regex(
  text: Expression<string>,
  source: string,
  options: RegexOptions = {},
): Expression<SqlBool> {
  const flags = options.flags ?? "";
  try {
    new RegExp(source, `${flags}u`);
  } catch (cause) {
    throw new InvalidDirectPatternError(source, flags, cause);
  }
  return sql<SqlBool>`regexp(${source}, ${text}, ${flags})`;
}
