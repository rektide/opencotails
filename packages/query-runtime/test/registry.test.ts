import assert from "node:assert/strict"
import test from "node:test"
import { Context, Effect, Layer } from "effect"
import {
  DuplicateQueryInstance,
  QueryCapability,
  QueryFactoryDependencyCycle,
  QueryFactoryDependencyNotFound,
  QueryInstanceId,
  QueryRegistry,
  queryFactory,
  queryKey,
  queryRegistryLayer,
} from "../src/index.ts"

const direct = QueryCapability.make("direct")
const history = QueryCapability.make("history")

const id = (value: string) => QueryInstanceId.make(value)

const scopedFactory = <World>(input: {
  readonly name: string
  readonly world: World
  readonly capabilities: readonly QueryCapability[]
  readonly dependencies?: readonly ReturnType<typeof queryKey<unknown>>[]
  readonly events: string[]
}) => {
  const key = queryKey<World>(id(input.name))
  return {
    key,
    factory: queryFactory({
      key,
      capabilities: input.capabilities,
      dependencies: input.dependencies,
      acquire: () =>
        Effect.acquireRelease(
          Effect.sync(() => {
            input.events.push(`acquire:${input.name}`)
            return input.world
          }),
          () =>
            Effect.sync(() => {
              input.events.push(`release:${input.name}`)
            }),
        ),
    }),
  }
}

test("publishes immutable instances with typed ID and capability lookup", async () => {
  const events: string[] = []
  const sessions = scopedFactory({
    name: "sessions",
    world: { selectSession: (sessionId: string) => `session:${sessionId}` },
    capabilities: [direct, history],
    events,
  })
  const messages = scopedFactory({
    name: "messages",
    world: { selectMessage: (messageId: string) => `message:${messageId}` },
    capabilities: [direct],
    events,
  })

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* QueryRegistry
      const sessionInstance = yield* registry.get(sessions.key)
      return {
        selected: sessionInstance.world.selectSession("ses_1"),
        all: registry.all.map((instance) => instance.key.id),
        direct: registry.byCapability(direct).map((instance) => instance.key.id),
        history: registry.byCapability(history).map((instance) => instance.key.id),
        frozen: Object.isFrozen(registry) && Object.isFrozen(registry.all),
      }
    }).pipe(Effect.provide(queryRegistryLayer([sessions.factory, messages.factory]))),
  )

  assert.deepEqual(result, {
    selected: "session:ses_1",
    all: [id("sessions"), id("messages")],
    direct: [id("sessions"), id("messages")],
    history: [id("sessions")],
    frozen: true,
  })
  assert.deepEqual(events, ["acquire:sessions", "acquire:messages", "release:messages", "release:sessions"])
})

test("rejects duplicate IDs before acquiring factories", async () => {
  const events: string[] = []
  const first = scopedFactory({ name: "same", world: {}, capabilities: [], events })
  const second = scopedFactory({ name: "same", world: {}, capabilities: [], events })

  const error = await Effect.runPromise(
    QueryRegistry.pipe(
      Effect.provide(queryRegistryLayer([first.factory, second.factory])),
      Effect.flip,
    ),
  )

  assert.ok(error instanceof DuplicateQueryInstance)
  assert.equal(error.id, id("same"))
  assert.deepEqual(events, [])
})

test("explicit replacement preserves declaration position and uses replacement dependencies", async () => {
  const events: string[] = []
  const dependency = scopedFactory({ name: "dependency", world: { value: 2 }, capabilities: [history], events })
  const original = scopedFactory({ name: "query", world: { value: 1 }, capabilities: [direct], events })
  const replacement = queryFactory({
    key: original.key,
    capabilities: [direct, history],
    dependencies: [dependency.key],
    acquire: (dependencies) =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          events.push("acquire:replacement")
          const source = yield* dependencies.get(dependency.key)
          return { value: source.value + 1 }
        }),
        () => Effect.sync(() => events.push("release:replacement")),
      ),
  })

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* QueryRegistry
      const instance = yield* registry.get(original.key)
      return { value: instance.world.value, ids: registry.all.map((item) => item.key.id) }
    }).pipe(
      Effect.provide(
        queryRegistryLayer([original.factory, dependency.factory], {
          replacements: [replacement],
        }),
      ),
    ),
  )

  assert.deepEqual(result, { value: 3, ids: [id("query"), id("dependency")] })
  assert.deepEqual(events, [
    "acquire:dependency",
    "acquire:replacement",
    "release:replacement",
    "release:dependency",
  ])
})

test("acquisition failure releases previously acquired instances exactly once", async () => {
  const events: string[] = []
  const first = scopedFactory({ name: "first", world: {}, capabilities: [], events })
  const failure = new Error("cannot open source")
  const failingKey = queryKey<never>(id("failing"))
  const failing = queryFactory({
    key: failingKey,
    capabilities: [],
    dependencies: [first.key],
    acquire: () => Effect.fail(failure),
  })

  const error = await Effect.runPromise(
    QueryRegistry.pipe(Effect.provide(queryRegistryLayer([failing, first.factory])), Effect.flip),
  )

  assert.equal(error, failure)
  assert.deepEqual(events, ["acquire:first", "release:first"])
})

test("reports missing dependencies and cycles before acquisition", async () => {
  const events: string[] = []
  const missingKey = queryKey<unknown>(id("missing"))
  const missing = scopedFactory({
    name: "needs-missing",
    world: {},
    capabilities: [],
    dependencies: [missingKey],
    events,
  })

  const missingError = await Effect.runPromise(
    QueryRegistry.pipe(Effect.provide(queryRegistryLayer([missing.factory])), Effect.flip),
  )
  assert.ok(missingError instanceof QueryFactoryDependencyNotFound)

  const leftKey = queryKey<unknown>(id("left"))
  const rightKey = queryKey<unknown>(id("right"))
  const left = queryFactory({ key: leftKey, capabilities: [], dependencies: [rightKey], acquire: () => Effect.void })
  const right = queryFactory({ key: rightKey, capabilities: [], dependencies: [leftKey], acquire: () => Effect.void })
  const cycleError = await Effect.runPromise(
    QueryRegistry.pipe(Effect.provide(queryRegistryLayer([left, right])), Effect.flip),
  )
  assert.ok(cycleError instanceof QueryFactoryDependencyCycle)
  assert.deepEqual(cycleError.path, [id("left"), id("right"), id("left")])
  assert.deepEqual(events, [])
})

test("carries external Effect service requirements through the registry Layer", async () => {
  class SourceConfig extends Context.Service<SourceConfig, { readonly prefix: string }>()("test/SourceConfig") {}

  const key = queryKey<{ readonly read: (value: string) => string }>(id("configured"))
  const configured = queryFactory({
    key,
    capabilities: [direct],
    acquire: Effect.fnUntraced(function* () {
      const config = yield* SourceConfig
      return { read: (value: string) => `${config.prefix}:${value}` }
    }),
  })

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* QueryRegistry
      return (yield* registry.get(key)).world.read("row")
    }).pipe(
      Effect.provide(
        queryRegistryLayer([configured]).pipe(
          Layer.provide(Layer.succeed(SourceConfig, SourceConfig.of({ prefix: "source" }))),
        ),
      ),
    ),
  )

  assert.equal(result, "source:row")
})
