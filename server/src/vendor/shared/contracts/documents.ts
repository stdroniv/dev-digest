import { z } from 'zod';

/**
 * Project Context documents (SPEC-01): Markdown files discovered under a repo
 * clone's configured root folders (default `specs`/`docs`/`insights`), attachable
 * path-only (never inline content) to agents and skills, and read fresh from the
 * PR's own clone at run time.
 */

/** One discovered `.md` file under a configured root, with a token estimate. */
export const ProjectDocument = z.object({
  /** Repo-relative POSIX path, e.g. "specs/SPEC-01-….md". */
  path: z.string(),
  /** The configured root this doc was found under, e.g. "specs". */
  root: z.string(),
  /** Locally-estimated token count (tokenizer adapter; no model call). */
  tokens: z.number().int().nonnegative(),
});
export type ProjectDocument = z.infer<typeof ProjectDocument>;

/** One agent→document attachment (ordered, path-only). */
export const AgentDocumentLink = z.object({
  path: z.string(),
  order: z.number().int(),
});
export type AgentDocumentLink = z.infer<typeof AgentDocumentLink>;

/** One skill→document attachment (ordered, path-only). */
export const SkillDocumentLink = z.object({
  path: z.string(),
  order: z.number().int(),
});
export type SkillDocumentLink = z.infer<typeof SkillDocumentLink>;
