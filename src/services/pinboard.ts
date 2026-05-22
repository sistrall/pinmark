import { HttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform";
import { Effect, type Schema } from "effect";
import { PinboardApiError, PinboardAuthError } from "../errors.js";
import { PinboardPostsAll, PinboardUpdate } from "../schemas/pinboard.js";

const PINBOARD_API_BASE = "https://api.pinboard.in/v1";

const buildUrl = (token: string, path: string, params: Record<string, string> = {}) => {
  const url = new URL(`${PINBOARD_API_BASE}${path}`);
  url.searchParams.set("auth_token", token);
  url.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
};

export class PinboardClient extends Effect.Service<PinboardClient>()("PinboardClient", {
  effect: Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;

    const get = <A, I>(token: string, path: string, schema: Schema.Schema<A, I>) =>
      Effect.gen(function* () {
        const req = HttpClientRequest.get(buildUrl(token, path));
        const res = yield* http.execute(req);
        if (res.status === 401) {
          return yield* Effect.fail(
            new PinboardAuthError({ message: "Pinboard rejected the API token" }),
          );
        }
        if (res.status >= 400) {
          return yield* Effect.fail(
            new PinboardApiError({
              status: res.status,
              message: `Pinboard ${path} returned ${res.status}`,
            }),
          );
        }
        return yield* HttpClientResponse.schemaBodyJson(schema)(res);
      }).pipe(
        Effect.mapError((cause) => {
          if (cause instanceof PinboardAuthError || cause instanceof PinboardApiError) {
            return cause;
          }
          return new PinboardApiError({
            status: 0,
            message: `Pinboard ${path} request failed: ${String(cause)}`,
          });
        }),
      );

    return {
      lastUpdate: (token: string) => get(token, "/posts/update", PinboardUpdate),
      allPosts: (token: string) => get(token, "/posts/all", PinboardPostsAll),
    } as const;
  }),
  dependencies: [],
}) {}
