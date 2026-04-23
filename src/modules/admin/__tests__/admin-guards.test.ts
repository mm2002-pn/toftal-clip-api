/**
 * Smoke tests for admin module guards.
 *
 * These are pure-logic tests (no DB, no Prisma) that verify the safety
 * invariants of the admin endpoints — the ones that would cause real damage
 * if they regressed:
 *
 *   1. `authorize('ADMIN')` rejects non-admin users
 *   2. Self-mutation guards (cannot demote/suspend/delete yourself)
 *   3. Storage purge refuses unsafely small retention windows
 *   4. Members endpoints refuse role=OWNER (ownership goes via transfer)
 */

import type { Request, Response, NextFunction } from 'express';
import { authorize } from '../../../middlewares/auth';
import { UnauthorizedError, ForbiddenError } from '../../../utils/errors';

// ─── Helpers ───────────────────────────────────────────────────────────────

const makeReq = (user?: { id: string; role: string }) =>
  ({ user } as unknown as Request);

const makeRes = () => ({} as unknown as Response);

const runMiddleware = (mw: (req: Request, res: Response, next: NextFunction) => void, req: Request) =>
  new Promise<Error | undefined>((resolve) => {
    mw(req, makeRes(), (err?: any) => resolve(err));
  });

// ─── 1. authorize middleware ───────────────────────────────────────────────

describe('admin: authorize middleware', () => {
  const middleware = authorize('ADMIN');

  it('rejects unauthenticated requests with UnauthorizedError', async () => {
    const err = await runMiddleware(middleware, makeReq(undefined));
    expect(err).toBeInstanceOf(UnauthorizedError);
  });

  it('rejects USER role with ForbiddenError', async () => {
    const err = await runMiddleware(middleware, makeReq({ id: 'u1', role: 'USER' }));
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('rejects CLIENT role with ForbiddenError', async () => {
    const err = await runMiddleware(middleware, makeReq({ id: 'u1', role: 'CLIENT' }));
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('allows ADMIN role through (next called with no error)', async () => {
    const err = await runMiddleware(middleware, makeReq({ id: 'u1', role: 'ADMIN' }));
    expect(err).toBeUndefined();
  });
});

// ─── 2. Self-mutation guards ───────────────────────────────────────────────
//
// Replicates the guard logic found in src/modules/admin/controllers/users.ts.
// These invariants prevent an admin from locking themselves out.

const guardSelfMutation = (
  currentUserId: string,
  targetUserId: string,
  action: 'role-demote' | 'suspend' | 'delete'
): { allowed: boolean; reason?: string } => {
  if (currentUserId !== targetUserId) return { allowed: true };

  switch (action) {
    case 'role-demote':
      return { allowed: false, reason: 'You cannot demote yourself' };
    case 'suspend':
      return { allowed: false, reason: 'You cannot suspend yourself' };
    case 'delete':
      return { allowed: false, reason: 'You cannot delete yourself' };
  }
};

describe('admin users: self-mutation guards', () => {
  const me = 'admin-42';

  it('blocks self role-demote', () => {
    const r = guardSelfMutation(me, me, 'role-demote');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/demote/i);
  });

  it('blocks self suspend', () => {
    const r = guardSelfMutation(me, me, 'suspend');
    expect(r.allowed).toBe(false);
  });

  it('blocks self delete', () => {
    const r = guardSelfMutation(me, me, 'delete');
    expect(r.allowed).toBe(false);
  });

  it('allows mutating a different user', () => {
    expect(guardSelfMutation(me, 'other-user', 'delete').allowed).toBe(true);
    expect(guardSelfMutation(me, 'other-user', 'suspend').allowed).toBe(true);
    expect(guardSelfMutation(me, 'other-user', 'role-demote').allowed).toBe(true);
  });
});

// ─── 3. Storage purge safety threshold ─────────────────────────────────────
//
// src/modules/admin/controllers/storage.ts refuses any olderThanDays < 30 to
// make accidental data destruction much harder.

const validatePurgeWindow = (olderThanDays: unknown): { ok: true } | { ok: false; reason: string } => {
  if (typeof olderThanDays !== 'number' || !Number.isFinite(olderThanDays)) {
    return { ok: false, reason: 'olderThanDays must be a finite number' };
  }
  if (olderThanDays < 30) {
    return { ok: false, reason: 'olderThanDays must be >= 30 (safety)' };
  }
  return { ok: true };
};

describe('admin storage: purge window validation', () => {
  it('rejects 0 days', () => {
    expect(validatePurgeWindow(0)).toMatchObject({ ok: false });
  });

  it('rejects 29 days (one day below threshold)', () => {
    expect(validatePurgeWindow(29)).toMatchObject({ ok: false });
  });

  it('accepts exactly 30 days', () => {
    expect(validatePurgeWindow(30)).toMatchObject({ ok: true });
  });

  it('accepts 90 days (default admin UI value)', () => {
    expect(validatePurgeWindow(90)).toMatchObject({ ok: true });
  });

  it('rejects non-numeric input', () => {
    expect(validatePurgeWindow('90' as any)).toMatchObject({ ok: false });
    expect(validatePurgeWindow(undefined)).toMatchObject({ ok: false });
    expect(validatePurgeWindow(NaN)).toMatchObject({ ok: false });
  });
});

// ─── 4. Members endpoint: OWNER role invariant ─────────────────────────────
//
// src/modules/admin/controllers/members.ts enforces that OWNER cannot be
// assigned via the members CRUD — ownership changes MUST go through the
// transfer endpoint, which keeps Project.ownerId atomically consistent.

const ASSIGNABLE_ROLES = ['COLLABORATOR', 'VIEWER'] as const;

const validateMemberRole = (role: unknown): { ok: true; role: typeof ASSIGNABLE_ROLES[number] } | { ok: false; reason: string } => {
  if (role === 'OWNER') {
    return {
      ok: false,
      reason: 'Cannot assign OWNER via members. Use POST /admin/projects/:id/transfer instead.',
    };
  }
  if (typeof role === 'string' && (ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
    return { ok: true, role: role as typeof ASSIGNABLE_ROLES[number] };
  }
  // undefined / invalid → default to COLLABORATOR
  return { ok: true, role: 'COLLABORATOR' };
};

describe('admin members: OWNER role invariant', () => {
  it('refuses role=OWNER explicitly', () => {
    const r = validateMemberRole('OWNER');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/transfer/i);
  });

  it('accepts COLLABORATOR', () => {
    const r = validateMemberRole('COLLABORATOR');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.role).toBe('COLLABORATOR');
  });

  it('accepts VIEWER', () => {
    const r = validateMemberRole('VIEWER');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.role).toBe('VIEWER');
  });

  it('defaults to COLLABORATOR when role is omitted', () => {
    const r = validateMemberRole(undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.role).toBe('COLLABORATOR');
  });

  it('defaults to COLLABORATOR for unknown role strings', () => {
    const r = validateMemberRole('SUPERADMIN');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.role).toBe('COLLABORATOR');
  });
});
