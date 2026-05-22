import type { Frontmatter } from "../schemas/frontmatter.js";
import type { PinboardPost } from "../schemas/pinboard.js";

// A bookmark as Pinboard knows it. Domain alias over the raw API shape so the
// rest of the code can talk about RemoteBookmark and not about a Pinboard `posts/all`
// row specifically.
export type RemoteBookmark = PinboardPost;

// A bookmark as the vault knows it: a parsed markdown file with frontmatter and body.
export interface LocalBookmark {
  readonly filename: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
}
