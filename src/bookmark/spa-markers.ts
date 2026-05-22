// SPA-framework markers in pre-extraction HTML. Used as a heuristic to escalate to
// headless when a below-threshold extraction looks like an SPA shell even if the
// domain isn't explicitly allowlisted.
const SPA_MARKERS =
  /__next_f|__nuxt|<div\s+id=["']?(?:root|app|__layout|__next|__nuxt)\b|data-reactroot|__INITIAL_STATE__|__remixContext|__APOLLO_STATE__/i;

export const looksLikeSpa = (html: string): boolean => SPA_MARKERS.test(html);
