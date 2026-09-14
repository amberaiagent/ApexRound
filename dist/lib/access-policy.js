// Published message versions are immutable: changing access requires a new version.
export const ENTRY_REQUIREMENTS = Object.freeze({
  1: 10000000n,
  2: 10000000n,
  3: 5000000n,
});
export const CURRENT_ENTRY_VERSION = 3;
export const REQUIRED_ACCESS_TOKENS = ENTRY_REQUIREMENTS[CURRENT_ENTRY_VERSION];
