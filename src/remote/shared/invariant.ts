// Vendored from @linxin666/dsh-ssh 0.3.6 (Apache-2.0, zhu1090093659/dsh-web).
// dsh-devforge consolidation modification: relative import paths adjusted to the
// devforge module layout; runtime behavior preserved. See THIRD_PARTY_NOTICES.md.
/** Invariant companion plugin (no assertions — nothing to check at runtime). */

/** Provides no assertions: the ssh plugin owns no cross-package runtime invariants. */
export function apply(): void {}
