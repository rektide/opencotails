import { sql, type Expression, type ExpressionBuilder, type SqlBool } from "kysely";

export interface SessionPredicateContext<DB, TB extends keyof DB> {
  readonly eb: ExpressionBuilder<DB, TB>;
  readonly session: {
    readonly sessionID: Expression<string>;
    readonly projectID: Expression<string>;
    readonly directory: Expression<string>;
    readonly updatedAt: Expression<number>;
  };
}

export interface SessionPredicate {
  <DB, TB extends keyof DB>(context: SessionPredicateContext<DB, TB>): Expression<SqlBool>;
}

export function sessionPredicate(predicate: SessionPredicate): SessionPredicate {
  return predicate;
}

function oneOf(value: Expression<string>, values: readonly string[]): Expression<SqlBool> {
  return values.length === 0
    ? sql<SqlBool>`0 = 1`
    : sql<SqlBool>`${value} in (${sql.join(values)})`;
}

export function sessionIDs(values: readonly string[]): SessionPredicate {
  return sessionPredicate((context) => oneOf(context.session.sessionID, values));
}

export function sessionProjectIDs(values: readonly string[]): SessionPredicate {
  return sessionPredicate((context) => oneOf(context.session.projectID, values));
}

export function sessionDirectoryExact(value: string): SessionPredicate {
  return sessionPredicate((context) => sql<SqlBool>`${context.session.directory} = ${value}`);
}

export function sessionDirectoryContains(value: string): SessionPredicate {
  return sessionPredicate((context) => sql<SqlBool>`instr(${context.session.directory}, ${value}) > 0`);
}

export function sessionUpdatedRange(range: {
  readonly from?: number;
  readonly to?: number;
}): SessionPredicate {
  return sessionPredicate((context) => {
    const expressions: Expression<SqlBool>[] = [];
    if (range.from !== undefined) expressions.push(sql<SqlBool>`${context.session.updatedAt} >= ${range.from}`);
    if (range.to !== undefined) expressions.push(sql<SqlBool>`${context.session.updatedAt} < ${range.to}`);
    return expressions.length === 0 ? sql<SqlBool>`1 = 1` : context.eb.and(expressions);
  });
}
