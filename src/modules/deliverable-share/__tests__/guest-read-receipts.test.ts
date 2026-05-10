/**
 * Unit tests for the guest bulk-read flow exposed by
 * POST /deliverable-share/:token/feedback/bulk-read.
 *
 * The controller has three things to get right:
 *  1. Filter the request to feedbacks that belong to the share's
 *     deliverable (anti-cross-deliverable injection).
 *  2. Skip feedbacks the guest authored themselves (a sender doesn't
 *     "read" their own message).
 *  3. Dedup against rows already keyed on (feedbackId, guestEmail) —
 *     Postgres NULLS DISTINCT means the auth UNIQUE constraint
 *     doesn't help us here, so the dedup MUST run application-side
 *     or every chat re-render creates new rows.
 */

interface FeedbackRow {
  id: string;
  versionId: string;
  guestEmail: string | null;
}

interface ReadRow {
  feedbackId: string;
  userId: string | null;
  guestEmail: string | null;
}

/**
 * Mirrors the controller filter that decides which feedbacks should
 * actually become new FeedbackRead rows for this guest.
 */
function selectNewReadIds(
  feedbacksInScope: FeedbackRow[],
  alreadyRead: ReadRow[],
  guestEmail: string
): string[] {
  // (2) skip own
  const others = feedbacksInScope.filter((f) => f.guestEmail !== guestEmail);
  // (3) skip already read
  const alreadyReadSet = new Set(
    alreadyRead
      .filter((r) => r.userId === null && r.guestEmail === guestEmail)
      .map((r) => r.feedbackId)
  );
  return others.filter((f) => !alreadyReadSet.has(f.id)).map((f) => f.id);
}

/**
 * Mirrors the (1) where-clause: only feedbacks belonging to the
 * share-link's deliverable are accepted, regardless of what IDs the
 * client sent. Without this an attacker could pass arbitrary
 * feedback IDs in the request body and have them marked as read.
 */
function feedbacksInScope(
  requestedIds: string[],
  allFeedbacksForVersions: FeedbackRow[]
): FeedbackRow[] {
  const requestedSet = new Set(requestedIds);
  return allFeedbacksForVersions.filter((f) => requestedSet.has(f.id));
}

describe('guest bulk-read — scope enforcement', () => {
  const allowedFeedbacks: FeedbackRow[] = [
    { id: 'fb1', versionId: 'v1', guestEmail: 'alice@example.com' },
    { id: 'fb2', versionId: 'v1', guestEmail: null },
  ];

  it('drops feedback IDs not belonging to the share-link deliverable', () => {
    const requested = ['fb1', 'fb2', 'fb-from-another-deliverable'];
    const inScope = feedbacksInScope(requested, allowedFeedbacks);
    expect(inScope.map((f) => f.id).sort()).toEqual(['fb1', 'fb2']);
  });

  it('returns an empty list when none of the requested IDs belong', () => {
    const inScope = feedbacksInScope(['x', 'y'], allowedFeedbacks);
    expect(inScope).toEqual([]);
  });
});

describe('guest bulk-read — author exclusion', () => {
  it("never marks a guest's own feedback as read", () => {
    const inScope: FeedbackRow[] = [
      { id: 'fb1', versionId: 'v1', guestEmail: 'alice@example.com' }, // own
      { id: 'fb2', versionId: 'v1', guestEmail: 'bob@example.com' },
      { id: 'fb3', versionId: 'v1', guestEmail: null }, // auth-user authored
    ];
    const ids = selectNewReadIds(inScope, [], 'alice@example.com');
    expect(ids).toEqual(['fb2', 'fb3']);
  });

  it('handles an empty case gracefully', () => {
    expect(selectNewReadIds([], [], 'alice@example.com')).toEqual([]);
  });
});

describe('guest bulk-read — dedup against existing reads', () => {
  const inScope: FeedbackRow[] = [
    { id: 'fb1', versionId: 'v1', guestEmail: null },
    { id: 'fb2', versionId: 'v1', guestEmail: null },
    { id: 'fb3', versionId: 'v1', guestEmail: null },
  ];

  it('skips feedbacks already read by THIS guest', () => {
    const reads: ReadRow[] = [
      { feedbackId: 'fb1', userId: null, guestEmail: 'alice@example.com' },
      { feedbackId: 'fb2', userId: null, guestEmail: 'alice@example.com' },
    ];
    const ids = selectNewReadIds(inScope, reads, 'alice@example.com');
    expect(ids).toEqual(['fb3']);
  });

  it("does NOT skip feedbacks read by a different guest", () => {
    const reads: ReadRow[] = [
      { feedbackId: 'fb1', userId: null, guestEmail: 'bob@example.com' },
      { feedbackId: 'fb2', userId: null, guestEmail: 'bob@example.com' },
    ];
    const ids = selectNewReadIds(inScope, reads, 'alice@example.com');
    expect(ids).toEqual(['fb1', 'fb2', 'fb3']);
  });

  it('does NOT skip feedbacks read by an authenticated user', () => {
    // Guard against a regression where the dedup matches userId
    // alone — that would let an auth read silence the guest's own
    // pending read receipt and break the double-check forever.
    const reads: ReadRow[] = [
      { feedbackId: 'fb1', userId: 'user-1', guestEmail: null },
    ];
    const ids = selectNewReadIds(inScope, reads, 'alice@example.com');
    expect(ids).toContain('fb1');
  });

  it('returns no new IDs when the guest has already read everything in scope', () => {
    const reads: ReadRow[] = [
      { feedbackId: 'fb1', userId: null, guestEmail: 'alice@example.com' },
      { feedbackId: 'fb2', userId: null, guestEmail: 'alice@example.com' },
      { feedbackId: 'fb3', userId: null, guestEmail: 'alice@example.com' },
    ];
    const ids = selectNewReadIds(inScope, reads, 'alice@example.com');
    expect(ids).toEqual([]);
  });
});

describe('guest bulk-read — end-to-end scenario', () => {
  // A guest opens a share link, scrolls through 5 messages (some
  // theirs, some from owner, some from another guest), then reloads.
  // The two requests should result in the right number of read rows
  // and reloads must be idempotent.

  const versionFeedbacks: FeedbackRow[] = [
    { id: 'fb-own-1', versionId: 'v1', guestEmail: 'alice@example.com' }, // own
    { id: 'fb-owner', versionId: 'v1', guestEmail: null }, // owner
    { id: 'fb-bob-1', versionId: 'v1', guestEmail: 'bob@example.com' },
    { id: 'fb-bob-2', versionId: 'v1', guestEmail: 'bob@example.com' },
    { id: 'fb-own-2', versionId: 'v1', guestEmail: 'alice@example.com' }, // own
  ];
  const aliceEmail = 'alice@example.com';
  let reads: ReadRow[] = [];

  function simulateBulkRead(requestedIds: string[]): { marked: number } {
    const inScope = feedbacksInScope(requestedIds, versionFeedbacks);
    const newIds = selectNewReadIds(inScope, reads, aliceEmail);
    reads = [
      ...reads,
      ...newIds.map((id) => ({
        feedbackId: id,
        userId: null as string | null,
        guestEmail: aliceEmail,
      })),
    ];
    return { marked: newIds.length };
  }

  it('1st scroll: marks all non-own feedbacks as read', () => {
    const result = simulateBulkRead([
      'fb-own-1',
      'fb-owner',
      'fb-bob-1',
      'fb-bob-2',
      'fb-own-2',
    ]);
    expect(result.marked).toBe(3);
    expect(reads.map((r) => r.feedbackId).sort()).toEqual([
      'fb-bob-1',
      'fb-bob-2',
      'fb-owner',
    ]);
  });

  it('reload: re-sends the same IDs, no new rows created (idempotent)', () => {
    const result = simulateBulkRead([
      'fb-own-1',
      'fb-owner',
      'fb-bob-1',
      'fb-bob-2',
      'fb-own-2',
    ]);
    expect(result.marked).toBe(0);
    expect(reads).toHaveLength(3);
  });

  it('attempt to mark someone else\'s deliverable IDs is rejected by scope', () => {
    const result = simulateBulkRead([
      'fb-someone-elses', // not in versionFeedbacks
      'fb-attacker',
    ]);
    expect(result.marked).toBe(0);
    expect(reads).toHaveLength(3);
  });
});
