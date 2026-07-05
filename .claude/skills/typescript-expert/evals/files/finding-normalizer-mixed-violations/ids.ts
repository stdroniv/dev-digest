/**
 * Domain identifiers used across the finding-normalization pipeline.
 */

type Brand<K, T> = K & { readonly __brand: T };

export type FindingId = Brand<string, 'FindingId'>;
export type UserId = Brand<string, 'UserId'>;

/**
 * FindingId constructor: any string in, FindingId out. There is no format
 * (uuid, prefix, whatever) enforced here, so the brand buys nothing beyond
 * a compile-time label — any string can become a "valid" FindingId with a
 * single unchecked cast, including empty strings or accidental user input.
 */
export function toFindingId(raw: string): FindingId {
  return raw as FindingId;
}

const USER_ID_PATTERN = /^usr_[a-z0-9]{8,}$/;

/**
 * UserId constructor: actually validates the shape before branding, so a
 * malformed string is rejected at the boundary instead of silently becoming
 * "valid" domain data.
 */
export function toUserId(raw: string): UserId {
  if (!USER_ID_PATTERN.test(raw)) {
    throw new Error(`Invalid user id: ${raw}`);
  }
  return raw as UserId;
}

/**
 * Returns the first item of a readonly array, or undefined. Plain, minimal,
 * correctly typed generic — nothing to change here.
 */
export function firstOf<T>(items: readonly T[]): T | undefined {
  return items[0];
}
