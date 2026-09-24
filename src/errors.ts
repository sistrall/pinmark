import { Data, Effect } from "effect";

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class PinboardApiError extends Data.TaggedError("PinboardApiError")<{
  readonly status: number;
  readonly message: string;
}> {}

export class PinboardAuthError extends Data.TaggedError("PinboardAuthError")<{
  readonly message: string;
}> {}

export type FetchErrorKind =
  | "http_error"
  | "timeout"
  | "dns"
  | "tls"
  | "no_content"
  | "paywall"
  | "captcha"
  | "redirect_loop"
  | "unsupported_content"
  | "too_large";

export class FetchError extends Data.TaggedError("FetchError")<{
  readonly kind: FetchErrorKind;
  readonly message: string;
  readonly httpCode?: number;
  readonly url: string;
}> {}

export class ExtractionError extends Data.TaggedError("ExtractionError")<{
  readonly message: string;
  readonly url: string;
  // Set when extraction was killed for exceeding `extraction.timeoutMs`.
  readonly timedOut?: boolean;
  readonly cause?: unknown;
}> {}

// Raised when extraction technically succeeded but produced too little content
// to count as a usable bookmark. `kind` distinguishes "we never tried headless"
// from "we tried headless and it still wasn't enough", which the failure logger
// uses to render an accurate message.
export class InsufficientContentError extends Data.TaggedError("InsufficientContentError")<{
  readonly kind: "below_threshold" | "escalation_failed";
  readonly wordCount: number;
  readonly threshold: number;
  readonly url: string;
  readonly message: string;
}> {}

export class VaultError extends Data.TaggedError("VaultError")<{
  readonly message: string;
  readonly path?: string;
  readonly cause?: unknown;
}> {}

export class StateError extends Data.TaggedError("StateError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// Pipeable that re-wraps any tagged error carrying a `.message` into a ConfigError.
// Used at the top of `sync` to funnel heterogeneous error channels into one type.
export const toConfigError = Effect.mapError(
  (e: { readonly message: string }) => new ConfigError({ message: e.message, cause: e }),
);
