/**
 * Unit tests for the guest emoji-reaction toggle logic exposed by
 * POST /deliverable-share/:token/feedback/:feedbackId/reactions.
 *
 * Mirrors the controller's three-way semantics (added / removed /
 * changed) but keyed on guestEmail instead of userId, so the
 * Postgres NULLS DISTINCT trick on the (feedbackId, userId) UNIQUE
 * constraint doesn't accidentally let a guest accumulate multiple
 * reactions on the same feedback.
 */

interface ExistingReaction {
  id: string;
  feedbackId: string;
  userId: string | null;
  guestEmail: string | null;
  emoji: string;
}

type ToggleAction = 'added' | 'removed' | 'changed';

/**
 * Replicates the relevant slice of the share-reactions controller —
 * decides what to do given the currently-stored reaction (if any) and
 * the incoming emoji from the guest. The real controller then issues
 * the matching Prisma call (create / delete / update).
 */
function decideGuestReactionAction(
  existing: ExistingReaction | null,
  incomingEmoji: string
): ToggleAction {
  if (!existing) return 'added';
  if (existing.emoji === incomingEmoji) return 'removed';
  return 'changed';
}

/**
 * The findFirst query the controller runs to detect a pre-existing
 * reaction by this guest on this feedback. Mirrored here so we can
 * sanity-check the where-clause shape — userId must be null and
 * guestEmail must match exactly, otherwise we'd accidentally pick
 * up an authenticated user's reaction (or another guest's).
 */
function findGuestReaction(
  rows: ExistingReaction[],
  feedbackId: string,
  guestEmail: string
): ExistingReaction | null {
  return (
    rows.find(
      (r) =>
        r.feedbackId === feedbackId &&
        r.userId === null &&
        r.guestEmail === guestEmail
    ) ?? null
  );
}

describe('guest reactions — toggle action', () => {
  it('adds when no prior reaction exists for this guest', () => {
    expect(decideGuestReactionAction(null, '👍')).toBe('added');
  });

  it('removes when re-tapping the same emoji', () => {
    const existing: ExistingReaction = {
      id: 'r1',
      feedbackId: 'fb1',
      userId: null,
      guestEmail: 'alice@example.com',
      emoji: '👍',
    };
    expect(decideGuestReactionAction(existing, '👍')).toBe('removed');
  });

  it('replaces when tapping a different emoji', () => {
    const existing: ExistingReaction = {
      id: 'r1',
      feedbackId: 'fb1',
      userId: null,
      guestEmail: 'alice@example.com',
      emoji: '👍',
    };
    expect(decideGuestReactionAction(existing, '🔥')).toBe('changed');
  });
});

describe('guest reactions — findFirst targeting', () => {
  const baseRows: ExistingReaction[] = [
    { id: 'r1', feedbackId: 'fb1', userId: 'user-1', guestEmail: null, emoji: '👍' },
    { id: 'r2', feedbackId: 'fb1', userId: null, guestEmail: 'alice@example.com', emoji: '👍' },
    { id: 'r3', feedbackId: 'fb1', userId: null, guestEmail: 'bob@example.com', emoji: '🔥' },
    { id: 'r4', feedbackId: 'fb2', userId: null, guestEmail: 'alice@example.com', emoji: '❤️' },
  ];

  it("never matches another guest's reaction", () => {
    const found = findGuestReaction(baseRows, 'fb1', 'alice@example.com');
    expect(found?.id).toBe('r2');
    expect(found?.guestEmail).toBe('alice@example.com');
  });

  it('never matches an authenticated user reaction', () => {
    // Even though guestEmail is null on the auth row, the userId !== null
    // filter must keep us away from it. A bug here would let an
    // attacker with no email at all toggle an auth user's reaction.
    const allWithoutEmail = baseRows.filter((r) => r.userId !== null);
    const found = findGuestReaction(allWithoutEmail, 'fb1', '');
    expect(found).toBeNull();
  });

  it('scopes the lookup to the requested feedback', () => {
    // Same email as r4 but on a different feedback — must not be
    // picked up when toggling on fb1.
    const found = findGuestReaction(baseRows, 'fb1', 'alice@example.com');
    expect(found?.feedbackId).toBe('fb1');
    expect(found?.id).not.toBe('r4');
  });

  it('returns null when the guest has no reaction yet on this feedback', () => {
    const found = findGuestReaction(baseRows, 'fb1', 'carol@example.com');
    expect(found).toBeNull();
  });
});

describe('guest reactions — end-to-end action sequence', () => {
  // Walks through a full WhatsApp-style toggle session for one guest
  // on one feedback to make sure the action stays consistent across
  // the dimensions (no reaction → 👍 → 👍 again → 🔥 → 🔥 again).

  const feedbackId = 'fb1';
  const email = 'alice@example.com';
  let rows: ExistingReaction[] = [];

  function applyAction(emoji: string): {
    action: ToggleAction;
    rowsAfter: ExistingReaction[];
  } {
    const existing = findGuestReaction(rows, feedbackId, email);
    const action = decideGuestReactionAction(existing, emoji);
    let next = [...rows];
    if (action === 'added') {
      next.push({
        id: `r${next.length + 1}`,
        feedbackId,
        userId: null,
        guestEmail: email,
        emoji,
      });
    } else if (action === 'removed') {
      next = next.filter((r) => r.id !== existing!.id);
    } else {
      next = next.map((r) =>
        r.id === existing!.id ? { ...r, emoji } : r
      );
    }
    rows = next;
    return { action, rowsAfter: next };
  }

  it('1st tap on 👍 adds', () => {
    const r = applyAction('👍');
    expect(r.action).toBe('added');
    expect(r.rowsAfter.find((x) => x.guestEmail === email)?.emoji).toBe('👍');
  });

  it('2nd tap on 👍 removes', () => {
    const r = applyAction('👍');
    expect(r.action).toBe('removed');
    expect(r.rowsAfter.find((x) => x.guestEmail === email)).toBeUndefined();
  });

  it('1st tap on 🔥 (after removal) adds again', () => {
    const r = applyAction('🔥');
    expect(r.action).toBe('added');
    expect(r.rowsAfter.find((x) => x.guestEmail === email)?.emoji).toBe('🔥');
  });

  it('tap on 👍 (with 🔥 active) replaces', () => {
    const r = applyAction('👍');
    expect(r.action).toBe('changed');
    // Critical invariant: at most one row per (feedbackId, guestEmail)
    // — otherwise the pills count drifts.
    const mine = r.rowsAfter.filter(
      (x) => x.feedbackId === feedbackId && x.guestEmail === email
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].emoji).toBe('👍');
  });
});
