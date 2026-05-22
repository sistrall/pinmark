import { Schema } from "effect";

const YesNo = Schema.transform(Schema.Literal("yes", "no"), Schema.Boolean, {
  decode: (s) => s === "yes",
  encode: (b) => (b ? "yes" : "no"),
  strict: true,
});

const SpaceSeparatedTags = Schema.transform(Schema.String, Schema.Array(Schema.String), {
  decode: (s) =>
    s
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
  encode: (tags) => tags.join(" "),
  strict: true,
});

export const PinboardPost = Schema.Struct({
  href: Schema.String,
  description: Schema.String,
  extended: Schema.String,
  meta: Schema.String,
  hash: Schema.String,
  time: Schema.Date,
  shared: YesNo,
  toread: YesNo,
  tags: SpaceSeparatedTags,
});
export type PinboardPost = typeof PinboardPost.Type;

export const PinboardPostsAll = Schema.Array(PinboardPost);
export type PinboardPostsAll = typeof PinboardPostsAll.Type;

export const PinboardUpdate = Schema.Struct({
  update_time: Schema.Date,
});
export type PinboardUpdate = typeof PinboardUpdate.Type;
