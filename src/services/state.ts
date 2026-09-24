import { FileSystem, Path } from "@effect/platform";
import { Effect, Option, Schema } from "effect";
import { StateError } from "../errors.js";

const StateFile = Schema.Struct({
  lastPinboardUpdate: Schema.optional(Schema.Date),
  // Layout the vault was last synced with. A different configured layout forces a
  // full pass so existing notes get moved even when Pinboard hasn't changed.
  layout: Schema.optional(Schema.String),
  schemaVersion: Schema.optionalWith(Schema.Number, { default: () => 1 }),
});
export type StateFile = typeof StateFile.Type;

const STATE_DIR = ".pinmark";
const STATE_FILE = "state.json";

export class State extends Effect.Service<State>()("State", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const filePathFor = (vaultRoot: string) => path.join(vaultRoot, STATE_DIR, STATE_FILE);
    const dirPathFor = (vaultRoot: string) => path.join(vaultRoot, STATE_DIR);

    const load = (vaultRoot: string): Effect.Effect<Option.Option<StateFile>, StateError> =>
      Effect.gen(function* () {
        const filePath = filePathFor(vaultRoot);
        const exists = yield* fs
          .exists(filePath)
          .pipe(
            Effect.mapError(
              (cause) => new StateError({ message: "Stat state file failed", cause }),
            ),
          );
        if (!exists) return Option.none<StateFile>();
        const raw = yield* fs
          .readFileString(filePath)
          .pipe(
            Effect.mapError(
              (cause) => new StateError({ message: "Read state file failed", cause }),
            ),
          );
        const parsed = yield* Effect.try({
          try: () => JSON.parse(raw) as unknown,
          catch: (cause) => new StateError({ message: "Parse state JSON failed", cause }),
        });
        const decoded = yield* Schema.decodeUnknown(StateFile)(parsed).pipe(
          Effect.mapError((cause) => new StateError({ message: "Decode state failed", cause })),
        );
        return Option.some(decoded);
      });

    const save = (vaultRoot: string, state: StateFile): Effect.Effect<void, StateError> =>
      Effect.gen(function* () {
        yield* fs
          .makeDirectory(dirPathFor(vaultRoot), { recursive: true })
          .pipe(
            Effect.mapError(
              (cause) => new StateError({ message: "Create state directory failed", cause }),
            ),
          );
        const encoded = yield* Schema.encode(StateFile)(state).pipe(
          Effect.mapError((cause) => new StateError({ message: "Encode state failed", cause })),
        );
        yield* fs
          .writeFileString(filePathFor(vaultRoot), `${JSON.stringify(encoded, null, 2)}\n`)
          .pipe(
            Effect.mapError(
              (cause) => new StateError({ message: "Write state file failed", cause }),
            ),
          );
      });

    return { load, save } as const;
  }),
  dependencies: [],
}) {}
