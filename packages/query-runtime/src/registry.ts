import { Context, Effect, Layer, Schema } from "effect"
import type { Scope } from "effect"

export const QueryInstanceId = Schema.Trim.pipe(
  Schema.check(Schema.isNonEmpty()),
  Schema.brand("QueryInstanceId"),
)
export type QueryInstanceId = typeof QueryInstanceId.Type

export const QueryCapability = Schema.Trim.pipe(
  Schema.check(Schema.isNonEmpty()),
  Schema.brand("QueryCapability"),
)
export type QueryCapability = typeof QueryCapability.Type

declare const QueryWorldType: unique symbol
declare const QueryFactoryErrorType: unique symbol
declare const QueryFactoryRequirementsType: unique symbol

export interface QueryKey<World> {
  readonly id: QueryInstanceId
  readonly [QueryWorldType]?: World
}

export const queryKey = <World>(id: QueryInstanceId): QueryKey<World> => Object.freeze({ id })

export interface QueryInstance<World> {
  readonly key: QueryKey<World>
  readonly capabilities: readonly QueryCapability[]
  readonly world: World
}

export class QueryInstanceNotFound extends Schema.TaggedErrorClass<QueryInstanceNotFound>()(
  "QueryInstanceNotFound",
  { id: QueryInstanceId },
) {}

export interface QueryDependencies {
  readonly get: <World>(key: QueryKey<World>) => Effect.Effect<World, QueryInstanceNotFound>
}

export interface QueryFactory<World, Error = never, Requirements = never> {
  readonly key: QueryKey<World>
  readonly capabilities: readonly QueryCapability[]
  readonly dependencies?: readonly QueryKey<unknown>[]
  readonly acquire: (
    dependencies: QueryDependencies,
  ) => Effect.Effect<World, Error, Requirements | Scope.Scope>
  readonly [QueryFactoryErrorType]: Error
  readonly [QueryFactoryRequirementsType]: Requirements
}

interface QueryFactoryInput<World, Error, Requirements> {
  readonly key: QueryKey<World>
  readonly capabilities: readonly QueryCapability[]
  readonly dependencies?: readonly QueryKey<unknown>[]
  readonly acquire: (dependencies: QueryDependencies) => Effect.Effect<World, Error, Requirements>
}

export const queryFactory = <World, Error, Requirements>(
  factory: QueryFactoryInput<World, Error, Requirements>,
): QueryFactory<World, Error, Exclude<Requirements, Scope.Scope>> =>
  Object.freeze({
    ...factory,
    capabilities: Object.freeze([...factory.capabilities]),
    dependencies: Object.freeze([...(factory.dependencies ?? [])]),
  }) as QueryFactory<World, Error, Exclude<Requirements, Scope.Scope>>

export class DuplicateQueryInstance extends Schema.TaggedErrorClass<DuplicateQueryInstance>()(
  "DuplicateQueryInstance",
  { id: QueryInstanceId, source: Schema.Literals(["factory", "replacement"]) },
) {}

export class QueryReplacementTargetNotFound extends Schema.TaggedErrorClass<QueryReplacementTargetNotFound>()(
  "QueryReplacementTargetNotFound",
  { id: QueryInstanceId },
) {}

export class QueryFactoryDependencyNotFound extends Schema.TaggedErrorClass<QueryFactoryDependencyNotFound>()(
  "QueryFactoryDependencyNotFound",
  { factoryId: QueryInstanceId, dependencyId: QueryInstanceId },
) {}

export class QueryFactoryDependencyCycle extends Schema.TaggedErrorClass<QueryFactoryDependencyCycle>()(
  "QueryFactoryDependencyCycle",
  { path: Schema.Array(QueryInstanceId) },
) {}

export type QueryRegistryConfigurationError =
  | DuplicateQueryInstance
  | QueryReplacementTargetNotFound
  | QueryFactoryDependencyNotFound
  | QueryFactoryDependencyCycle

export interface QueryRegistryShape {
  readonly all: readonly QueryInstance<unknown>[]
  readonly get: <World>(key: QueryKey<World>) => Effect.Effect<QueryInstance<World>, QueryInstanceNotFound>
  readonly byCapability: (capability: QueryCapability) => readonly QueryInstance<unknown>[]
}

export class QueryRegistry extends Context.Service<QueryRegistry, QueryRegistryShape>()(
  "@opencoattails/QueryRegistry",
) {}

interface ErasedQueryFactory {
  readonly key: QueryKey<unknown>
  readonly capabilities: readonly QueryCapability[]
  readonly dependencies?: readonly QueryKey<unknown>[]
  readonly acquire: (dependencies: QueryDependencies) => Effect.Effect<unknown, unknown, unknown>
}

type ValidateFactories<Factories extends readonly unknown[]> = Factories[number] extends ErasedQueryFactory
  ? unknown
  : { readonly "Invalid query factory": Exclude<Factories[number], ErasedQueryFactory> }

type FactoryErrorOf<Factory> = [Factory] extends [never]
  ? never
  : Factory extends { readonly [QueryFactoryErrorType]: infer Error }
    ? [Error] extends [never]
      ? never
      : Error
    : never

type FactoryError<Factories extends readonly unknown[]> = FactoryErrorOf<Factories[number]>

type FactoryRequirementsOf<Factory> = [Factory] extends [never]
  ? never
  : Factory extends { readonly [QueryFactoryRequirementsType]: infer Requirements }
    ? [Requirements] extends [never]
      ? never
      : Exclude<Requirements, Scope.Scope>
    : never

type FactoryRequirements<Factories extends readonly unknown[]> = FactoryRequirementsOf<Factories[number]>

export interface QueryRegistryLayerOptions<
  Replacements extends readonly unknown[] = readonly [],
> {
  readonly replacements?: Replacements & ValidateFactories<Replacements>
}

export const queryRegistryLayer = <
  const Factories extends readonly unknown[],
  const Replacements extends readonly unknown[] = readonly [],
>(
  factories: Factories & ValidateFactories<Factories>,
  options: QueryRegistryLayerOptions<Replacements> = {},
): Layer.Layer<
  QueryRegistry,
  QueryRegistryConfigurationError | FactoryError<Factories> | FactoryError<Replacements>,
  FactoryRequirements<Factories> | FactoryRequirements<Replacements>
> =>
  Layer.effect(
    QueryRegistry,
    buildRegistry(factories as readonly ErasedQueryFactory[], (options.replacements ?? []) as readonly ErasedQueryFactory[]),
  ) as Layer.Layer<
    QueryRegistry,
    QueryRegistryConfigurationError | FactoryError<Factories> | FactoryError<Replacements>,
    FactoryRequirements<Factories> | FactoryRequirements<Replacements>
  >

const buildRegistry = (
  factories: readonly ErasedQueryFactory[],
  replacements: readonly ErasedQueryFactory[],
) =>
  Effect.gen(function* () {
    const configured = yield* configureFactories(factories, replacements)
    const order = yield* acquisitionOrder(configured)
    const acquired = new Map<QueryInstanceId, QueryInstance<unknown>>()
    const dependencies: QueryDependencies = {
      get: <World>(key: QueryKey<World>) => {
        const instance = acquired.get(key.id)
        return instance === undefined
          ? Effect.fail(new QueryInstanceNotFound({ id: key.id }))
          : Effect.succeed(instance.world as World)
      },
    }

    yield* Effect.forEach(
      order,
      (factory) =>
        factory.acquire(dependencies).pipe(
          Effect.tap((world) =>
            Effect.sync(() => {
              acquired.set(
                factory.key.id,
                Object.freeze({
                  key: factory.key,
                  capabilities: factory.capabilities,
                  world,
                }),
              )
            }),
          ),
        ),
      { concurrency: 1, discard: true },
    )

    const all = Object.freeze(configured.map((factory) => acquired.get(factory.key.id)!))
    const registry: QueryRegistryShape = Object.freeze({
      all,
      get: <World>(key: QueryKey<World>) => {
        const instance = acquired.get(key.id)
        return instance === undefined
          ? Effect.fail(new QueryInstanceNotFound({ id: key.id }))
          : Effect.succeed(instance as QueryInstance<World>)
      },
      byCapability: (capability: QueryCapability) =>
        Object.freeze(all.filter((instance) => instance.capabilities.includes(capability))),
    })
    return QueryRegistry.of(registry)
  })

const configureFactories = (
  factories: readonly ErasedQueryFactory[],
  replacements: readonly ErasedQueryFactory[],
): Effect.Effect<readonly ErasedQueryFactory[], QueryRegistryConfigurationError> =>
  Effect.gen(function* () {
    const positions = new Map<QueryInstanceId, number>()
    const configured = [...factories]
    for (const [index, factory] of factories.entries()) {
      if (positions.has(factory.key.id)) {
        return yield* new DuplicateQueryInstance({ id: factory.key.id, source: "factory" })
      }
      positions.set(factory.key.id, index)
    }

    const replaced = new Set<QueryInstanceId>()
    for (const replacement of replacements) {
      const position = positions.get(replacement.key.id)
      if (position === undefined) {
        return yield* new QueryReplacementTargetNotFound({ id: replacement.key.id })
      }
      if (replaced.has(replacement.key.id)) {
        return yield* new DuplicateQueryInstance({ id: replacement.key.id, source: "replacement" })
      }
      replaced.add(replacement.key.id)
      configured[position] = replacement
    }
    return configured
  })

const acquisitionOrder = (
  factories: readonly ErasedQueryFactory[],
): Effect.Effect<readonly ErasedQueryFactory[], QueryRegistryConfigurationError> =>
  Effect.gen(function* () {
    const byId = new Map(factories.map((factory) => [factory.key.id, factory]))
    const complete = new Set<QueryInstanceId>()
    const visiting = new Set<QueryInstanceId>()
    const stack: QueryInstanceId[] = []
    const order: ErasedQueryFactory[] = []

    const visit = (factory: ErasedQueryFactory): Effect.Effect<void, QueryRegistryConfigurationError> =>
      Effect.gen(function* () {
        if (complete.has(factory.key.id)) return
        if (visiting.has(factory.key.id)) {
          const start = stack.indexOf(factory.key.id)
          return yield* new QueryFactoryDependencyCycle({ path: [...stack.slice(start), factory.key.id] })
        }
        visiting.add(factory.key.id)
        stack.push(factory.key.id)
        for (const dependencyKey of factory.dependencies ?? []) {
          const dependency = byId.get(dependencyKey.id)
          if (dependency === undefined) {
            return yield* new QueryFactoryDependencyNotFound({
              factoryId: factory.key.id,
              dependencyId: dependencyKey.id,
            })
          }
          yield* visit(dependency)
        }
        stack.pop()
        visiting.delete(factory.key.id)
        complete.add(factory.key.id)
        order.push(factory)
      })

    for (const factory of factories) yield* visit(factory)
    return order
  })
