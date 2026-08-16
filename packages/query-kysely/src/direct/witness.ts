import type { Expression, ExpressionBuilder, SelectQueryBuilder, SqlBool } from "kysely";
import type { CotailRelations } from "../relations/schema.ts";

declare const witnessNameBrand: unique symbol;

export type WitnessName = string & { readonly [witnessNameBrand]: true };
export type DocumentPredicate = (
  eb: ExpressionBuilder<CotailRelations, "cotail_document">,
) => Expression<SqlBool>;

export interface DocumentWitness {
  readonly name: WitnessName;
  readonly matches: DocumentPredicate;
  readonly forSession: <DB extends CotailRelations, TB extends keyof DB>(context: {
    readonly eb: ExpressionBuilder<DB, TB>;
    readonly sessionID: Expression<string>;
  }) => Expression<SqlBool>;
}

export function witnessName(value: string): WitnessName {
  if (value.length === 0 || value.trim().length === 0) {
    throw new TypeError("witness name must not be empty");
  }
  return value as WitnessName;
}

export function documentWitness(name: WitnessName, matches: DocumentPredicate): DocumentWitness {
  return Object.freeze({
    name,
    matches,
    forSession: <DB extends CotailRelations, TB extends keyof DB>({ eb, sessionID }: {
      readonly eb: ExpressionBuilder<DB, TB>;
      readonly sessionID: Expression<string>;
    }): Expression<SqlBool> => {
      const documents = eb.selectFrom("cotail_document") as unknown as SelectQueryBuilder<
        CotailRelations,
        "cotail_document",
        Record<never, never>
      >;
      return eb.exists(documents
        .select("cotail_document.documentKey")
        .where("cotail_document.sessionID", "=", sessionID)
        .where(matches));
    },
  });
}
