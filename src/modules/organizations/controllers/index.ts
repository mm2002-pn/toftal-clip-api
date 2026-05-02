import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { EmailService } from '../../../services/EmailService';
import { socketService } from '../../../services/socketService';

const emailService = new EmailService();
const TEAM_INVITE_EXPIRY_DAYS = 30;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Slugify: lowercase, ascii-only, hyphenated. Append a 6-char random suffix
// so two orgs named "Toftal Studio" don't collide on the unique slug column.
const generateSlug = (name: string): string => {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'team';
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
};

// Create an organization. The creator is automatically added as ADMIN/ACTIVE
// member in the same transaction so we never end up with an org that has no
// admin. V1 keeps it simple — one org per user max — enforced here, not at the
// DB level (we may relax later).
export const createOrganization = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { name } = req.body as { name?: string };

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      ApiResponse.badRequest(res, "Le nom de l'équipe est requis.");
      return;
    }
    const trimmed = name.trim().slice(0, 80);

    // Multi-org is allowed: a user can create or be a member of any number of
    // teams. The sidebar switcher already supports listing all of them.

    const org = await prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: {
          name: trimmed,
          slug: generateSlug(trimmed),
          createdById: userId,
        },
      });
      await tx.organizationMember.create({
        data: {
          organizationId: created.id,
          userId,
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });
      return created;
    });

    ApiResponse.created(res, org, 'Équipe créée avec succès');
  } catch (error) {
    next(error);
  }
};

// Return the active organizations the current user is a member of. V1 should
// always return 0 or 1 entries because of the createOrganization guard, but
// we shape the API as a list to leave room for V2.
export const getMyOrganizations = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;

    const memberships = await prisma.organizationMember.findMany({
      where: { userId, status: 'ACTIVE' },
      include: {
        organization: {
          include: {
            createdBy: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });

    const orgs = memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      logoUrl: m.organization.logoUrl,
      role: m.role,
      joinedAt: m.joinedAt,
      createdAt: m.organization.createdAt,
      // Used by the empty-state on /projects when a member joins but has no
      // project yet — "[Owner] doit vous ajouter à un projet."
      adminName: m.organization.createdBy.name,
      adminId: m.organization.createdBy.id,
    }));

    ApiResponse.success(res, orgs, 'Liste des équipes');
  } catch (error) {
    next(error);
  }
};

// Bulk-invite users to an organisation by email. Used both during the create
// wizard step 2 and from the dedicated invite UI later. Per-email outcomes are
// returned so the client can render "3 sent · 1 already a member" without
// blowing the whole request on one bad address.
export const sendTeamInvitations = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const orgId = String(req.params.orgId || '');
    const rawEmails = (req.body?.emails as unknown) ?? [];

    if (!orgId) {
      ApiResponse.badRequest(res, 'Identifiant d\'équipe manquant.');
      return;
    }
    if (!Array.isArray(rawEmails) || rawEmails.length === 0) {
      ApiResponse.badRequest(res, 'Liste d\'emails requise.');
      return;
    }
    if (rawEmails.length > 50) {
      ApiResponse.badRequest(res, 'Maximum 50 invitations par envoi.');
      return;
    }

    // Inviter must be an active ADMIN of the org. Members can't invite per spec.
    const membership = await prisma.organizationMember.findFirst({
      where: { organizationId: orgId, userId, status: 'ACTIVE' },
    });
    if (!membership || membership.role !== 'ADMIN') {
      ApiResponse.forbidden(res, "Seul l'administrateur de l'équipe peut inviter.");
      return;
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        createdBy: { select: { name: true, email: true } },
      },
    });
    if (!org) {
      ApiResponse.notFound(res, 'Équipe introuvable.');
      return;
    }

    const inviter = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    const inviterName = inviter?.name || org.createdBy.name || 'Un membre';

    // Normalise + dedupe + validate. Skip junk early so we don't open DB
    // transactions for clearly bad input.
    const seen = new Set<string>();
    const candidates: string[] = [];
    const errors: { email: string; reason: string }[] = [];
    for (const raw of rawEmails) {
      const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
      if (!email) continue;
      if (seen.has(email)) continue;
      seen.add(email);
      if (!EMAIL_REGEX.test(email)) {
        errors.push({ email, reason: 'Email invalide' });
        continue;
      }
      // Prevent inviting yourself.
      if (inviter?.email && email === inviter.email.toLowerCase()) {
        errors.push({ email, reason: 'Vous êtes déjà membre' });
        continue;
      }
      candidates.push(email);
    }

    const sent: string[] = [];
    const expiresAt = new Date(Date.now() + TEAM_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    for (const email of candidates) {
      try {
        // Already a member?
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
          const existing = await prisma.organizationMember.findFirst({
            where: { organizationId: orgId, userId: existingUser.id, status: 'ACTIVE' },
          });
          if (existing) {
            errors.push({ email, reason: 'Déjà membre de l\'équipe' });
            continue;
          }
        }

        // Pending invitation already? Per spec we refuse and tell the user.
        // The owner can resend (= renew) only when the previous one expired.
        const pendingInvite = await prisma.teamInvitation.findFirst({
          where: { organizationId: orgId, email, status: 'PENDING' },
        });
        if (pendingInvite) {
          // Auto-expire if past TTL — that converts this case into the "renew"
          // path below on the next attempt.
          if (pendingInvite.expiresAt < new Date()) {
            await prisma.teamInvitation.update({
              where: { id: pendingInvite.id },
              data: { status: 'EXPIRED' },
            });
          } else {
            errors.push({ email, reason: 'Une invitation a déjà été envoyée à cet email' });
            continue;
          }
        }

        // Renew flow: an EXPIRED row exists → reuse it with a fresh token.
        const expiredInvite = await prisma.teamInvitation.findFirst({
          where: { organizationId: orgId, email, status: 'EXPIRED' },
          orderBy: { createdAt: 'desc' },
        });
        const token = crypto.randomBytes(32).toString('hex');
        if (expiredInvite) {
          await prisma.teamInvitation.update({
            where: { id: expiredInvite.id },
            data: {
              token,
              expiresAt,
              invitedById: userId,
              status: 'PENDING',
              acceptedAt: null,
            },
          });
        } else {
          await prisma.teamInvitation.create({
            data: {
              organizationId: orgId,
              invitedById: userId,
              email,
              token,
              expiresAt,
            },
          });
        }

        // If the email belongs to an existing user, also push an in-app
        // notification with a deep-link to the accept page. Otherwise the
        // invitee can only see the invitation in their inbox — easy to miss
        // for users already logged in.
        const existingInvitee = await prisma.user.findUnique({
          where: { email },
          select: { id: true },
        });
        if (existingInvitee) {
          try {
            const notif = await prisma.notification.create({
              data: {
                userId: existingInvitee.id,
                type: 'TEAM_INVITATION',
                title: 'Invitation à rejoindre une équipe',
                message: `${inviterName} vous invite à rejoindre l'équipe "${org.name}"`,
                link: `/accept-invitation?token=${token}&type=team`,
              },
            });
            socketService.emitToUser(existingInvitee.id, 'notification:new', notif);
          } catch (notifErr) {
            console.error(`[team-invite] in-app notif failed for ${email}:`, notifErr);
          }
        }

        // Email failures shouldn't roll back the invitation row — the user can
        // resend later from the team page. Surface the failure as a
        // per-address error.
        try {
          await emailService.sendTeamInvitationEmail({
            to: email,
            teamName: org.name,
            inviterName,
            invitationToken: token,
          });
          sent.push(email);
        } catch (emailErr) {
          console.error(`[team-invite] email send failed for ${email}:`, emailErr);
          errors.push({ email, reason: 'Envoi email échoué' });
        }
      } catch (err) {
        console.error(`[team-invite] failed for ${email}:`, err);
        errors.push({ email, reason: 'Erreur serveur' });
      }
    }

    ApiResponse.success(res, { sent, errors }, 'Invitations traitées');
  } catch (error) {
    next(error);
  }
};

// Verify a team invitation token. Public — anyone with the token may peek
// at the metadata so the AcceptInvitation page can show the team name + the
// email it was sent to before the user authenticates.
export const verifyTeamInvitationToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = String(req.params.token || '');
    if (!token) {
      ApiResponse.badRequest(res, 'Token manquant.');
      return;
    }

    const invitation = await prisma.teamInvitation.findUnique({
      where: { token },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        invitedBy: { select: { name: true } },
      },
    });

    if (!invitation) {
      ApiResponse.notFound(res, 'Invitation introuvable.');
      return;
    }
    if (invitation.status === 'ACCEPTED') {
      ApiResponse.error(res, 'Cette invitation a déjà été acceptée.', 410);
      return;
    }
    if (invitation.status === 'EXPIRED' || invitation.expiresAt < new Date()) {
      // Mark as expired in DB if it just timed out — keeps reads cheap later.
      if (invitation.status === 'PENDING') {
        await prisma.teamInvitation.update({
          where: { id: invitation.id },
          data: { status: 'EXPIRED' },
        });
      }
      ApiResponse.error(res, 'Cette invitation a expiré. Demandez une nouvelle invitation à votre équipe.', 410);
      return;
    }

    ApiResponse.success(res, {
      id: invitation.id,
      email: invitation.email,
      organizationId: invitation.organization.id,
      organizationName: invitation.organization.name,
      organizationSlug: invitation.organization.slug,
      inviterName: invitation.invitedBy.name,
      expiresAt: invitation.expiresAt,
    });
  } catch (error) {
    next(error);
  }
};

// Accept a team invitation. Auth required — the email of the authenticated
// user must match the invitation email (case-insensitive). Creates the
// OrganizationMember row and marks the invitation as ACCEPTED in the same
// transaction so a refresh-and-retry can't double-membership.
export const acceptTeamInvitation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const userEmail = req.user!.email.toLowerCase();
    const token = typeof req.body?.token === 'string' ? req.body.token : '';

    if (!token) {
      ApiResponse.badRequest(res, 'Token manquant.');
      return;
    }

    const invitation = await prisma.teamInvitation.findUnique({
      where: { token },
      include: { organization: { select: { id: true, name: true } } },
    });

    if (!invitation) {
      ApiResponse.notFound(res, 'Invitation introuvable.');
      return;
    }
    if (invitation.status === 'ACCEPTED') {
      // Idempotent: if the user is already a member, treat as success — same
      // pattern as ProjectInvitation. Saves the user from confusing errors on
      // double-clicks.
      const existing = await prisma.organizationMember.findFirst({
        where: { organizationId: invitation.organizationId, userId, status: 'ACTIVE' },
      });
      if (existing) {
        ApiResponse.success(res, {
          organizationId: invitation.organization.id,
          organizationName: invitation.organization.name,
        }, 'Vous êtes déjà membre de cette équipe.');
        return;
      }
      ApiResponse.error(res, 'Cette invitation a déjà été acceptée par quelqu\'un d\'autre.', 410);
      return;
    }
    if (invitation.status === 'EXPIRED' || invitation.expiresAt < new Date()) {
      ApiResponse.error(res, 'Cette invitation a expiré.', 410);
      return;
    }

    // Email match — defensive even though the front prevents it. Compare
    // lowercase to avoid case mismatches.
    if (userEmail !== invitation.email.toLowerCase()) {
      ApiResponse.forbidden(res, `Cette invitation a été envoyée à ${invitation.email}. Connectez-vous avec ce compte pour l'accepter.`);
      return;
    }

    // Multi-org is allowed. The sidebar workspace switcher handles multiple
    // memberships — accepting a new invitation just adds the user to one more
    // team without affecting the others.

    await prisma.$transaction(async (tx) => {
      // upsert in case a previous attempt created the member but failed before
      // marking the invitation accepted.
      await tx.organizationMember.upsert({
        where: { organizationId_userId: { organizationId: invitation.organizationId, userId } },
        create: {
          organizationId: invitation.organizationId,
          userId,
          role: 'MEMBER',
          status: 'ACTIVE',
        },
        update: {
          status: 'ACTIVE',
          role: 'MEMBER',
        },
      });
      await tx.teamInvitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });
    });

    // Auto-join the new member's currently-open tabs to the org room so they
    // receive realtime team events (project:new, etc.) without having to
    // reconnect. No-op if the user has no open socket on this instance —
    // their next reconnect will auto-join via the connection handler.
    socketService.addUserToOrgRoom(userId, invitation.organizationId);

    // Notify the org admin(s) — in-app + email per spec. Failures are logged
    // but don't fail the acceptance (the member is in, the host can be told
    // later if needed).
    try {
      const newMember = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });
      const admins = await prisma.organizationMember.findMany({
        where: { organizationId: invitation.organizationId, role: 'ADMIN', status: 'ACTIVE' },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
      const memberName = newMember?.name || invitation.email;
      const memberEmail = newMember?.email || invitation.email;
      const orgName = invitation.organization.name;
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

      for (const admin of admins) {
        // Don't self-notify if the new member is somehow already an admin too
        if (admin.user.id === userId) continue;

        const notification = await prisma.notification.create({
          data: {
            userId: admin.user.id,
            type: 'TEAM_MEMBER_JOINED',
            title: 'Nouveau membre',
            message: `${memberName} a rejoint l'équipe "${orgName}"`,
            link: '/team',
          },
        });
        socketService.emitToUser(admin.user.id, 'notification:new', notification);

        try {
          await emailService.sendTeamMemberJoinedEmail({
            to: admin.user.email,
            ownerName: admin.user.name,
            memberName,
            memberEmail,
            teamName: orgName,
            addToProjectUrl: `${frontendUrl}/#/team`,
          });
        } catch (mailErr) {
          console.error('[ACCEPT_TEAM_INVITATION] admin email failed (non-fatal):', mailErr);
        }
      }
    } catch (notifErr) {
      console.error('[ACCEPT_TEAM_INVITATION] admin notification failed (non-fatal):', notifErr);
    }

    ApiResponse.success(res, {
      organizationId: invitation.organization.id,
      organizationName: invitation.organization.name,
    }, 'Invitation acceptée');
  } catch (error) {
    next(error);
  }
};

// Refuse a team invitation. Public — uses the token as proof, mirrors the
// project invitation refuse flow (no auth required so an invitee who never
// signed up can decline). Notifies the inviting admin in-app + via socket.
export const refuseTeamInvitation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';

    if (!token) {
      ApiResponse.badRequest(res, 'Token manquant.');
      return;
    }

    const invitation = await prisma.teamInvitation.findUnique({
      where: { token },
      include: {
        organization: { select: { id: true, name: true } },
        invitedBy: { select: { id: true, name: true, email: true } },
      },
    });

    if (!invitation) {
      ApiResponse.notFound(res, 'Invitation introuvable.');
      return;
    }
    if (invitation.status === 'REJECTED') {
      ApiResponse.error(res, 'Cette invitation a déjà été refusée.', 410);
      return;
    }
    if (invitation.status === 'ACCEPTED') {
      ApiResponse.error(res, 'Cette invitation a déjà été acceptée.', 410);
      return;
    }
    if (invitation.status === 'EXPIRED' || invitation.expiresAt < new Date()) {
      ApiResponse.error(res, 'Cette invitation a expiré.', 410);
      return;
    }

    await prisma.teamInvitation.update({
      where: { id: invitation.id },
      data: {
        status: 'REJECTED',
        refusedAt: new Date(),
        refusalReason: reason || null,
      },
    });

    // Notify the admin who sent the invitation. Email/socket failures must
    // not roll back the refusal — the invitation is already declined.
    try {
      const message = reason
        ? `${invitation.email} a refusé l'invitation à rejoindre "${invitation.organization.name}". Raison : ${reason}`
        : `${invitation.email} a refusé l'invitation à rejoindre "${invitation.organization.name}"`;

      const notification = await prisma.notification.create({
        data: {
          userId: invitation.invitedBy.id,
          type: 'INVITATION_REJECTED',
          title: 'Invitation refusée',
          message,
          link: '/team',
        },
      });

      socketService.emitToUser(invitation.invitedBy.id, 'notification:new', notification);
    } catch (notifErr) {
      console.error('[REFUSE_TEAM_INVITATION] notification failed (non-fatal):', notifErr);
    }

    ApiResponse.success(res, null, 'Invitation refusée');
  } catch (error) {
    next(error);
  }
};

// Empty-state CTA on /projects for a member who has no project yet. Notifies
// the team admin(s) in-app + email so they know to add the member somewhere.
// Throttled implicitly by the UI ("Notifier" button disables for a few seconds
// after click) — no DB-side rate limit yet, may add if abused.
export const notifyTeamAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const orgId = String(req.params.orgId || '');

    const membership = await prisma.organizationMember.findFirst({
      where: { organizationId: orgId, userId, status: 'ACTIVE' },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!membership) {
      ApiResponse.forbidden(res, "Vous n'êtes pas membre de cette équipe.");
      return;
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true },
    });
    if (!org) {
      ApiResponse.notFound(res, 'Équipe introuvable.');
      return;
    }

    const admins = await prisma.organizationMember.findMany({
      where: { organizationId: orgId, role: 'ADMIN', status: 'ACTIVE' },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    const memberName = membership.user.name;
    const memberEmail = membership.user.email;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    for (const admin of admins) {
      if (admin.user.id === userId) continue;
      const notification = await prisma.notification.create({
        data: {
          userId: admin.user.id,
          type: 'TEAM_MEMBER_REQUESTS_ACCESS',
          title: 'Demande d\'accès',
          message: `${memberName} attend d'être ajouté à un projet de "${org.name}"`,
          link: '/team',
        },
      });
      socketService.emitToUser(admin.user.id, 'notification:new', notification);
      try {
        await emailService.sendTeamMemberRequestsAccessEmail({
          to: admin.user.email,
          ownerName: admin.user.name,
          memberName,
          memberEmail,
          teamName: org.name,
          addToProjectUrl: `${frontendUrl}/#/team`,
        });
      } catch (mailErr) {
        console.error('[NOTIFY_TEAM_ADMIN] email failed (non-fatal):', mailErr);
      }
    }

    ApiResponse.success(res, { notified: admins.length }, 'Notification envoyée');
  } catch (error) {
    next(error);
  }
};

// Resend a pending or expired team invitation. Issues a fresh token (the old
// one is invalidated by being overwritten) and pushes the expiry back by 30
// days. Useful for the "Renvoyer" button next to a pending invitation row.
export const resendTeamInvitation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const orgId = String(req.params.orgId || '');
    const invitationId = String(req.params.invitationId || '');

    // Admin-only: aligned with the rest of the invitation lifecycle.
    const membership = await prisma.organizationMember.findFirst({
      where: { organizationId: orgId, userId, status: 'ACTIVE' },
    });
    if (!membership || membership.role !== 'ADMIN') {
      ApiResponse.forbidden(res, "Seul l'administrateur peut renvoyer une invitation.");
      return;
    }

    const invitation = await prisma.teamInvitation.findUnique({
      where: { id: invitationId },
      include: {
        organization: { select: { name: true } },
      },
    });
    if (!invitation || invitation.organizationId !== orgId) {
      ApiResponse.notFound(res, 'Invitation introuvable.');
      return;
    }
    if (invitation.status === 'ACCEPTED') {
      ApiResponse.error(res, 'Cette invitation a déjà été acceptée.', 410);
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.teamInvitation.update({
      where: { id: invitation.id },
      data: {
        token,
        expiresAt,
        status: 'PENDING',
        invitedById: userId,
        acceptedAt: null,
        refusedAt: null,
        refusalReason: null,
      },
    });

    const inviter = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    try {
      await emailService.sendTeamInvitationEmail({
        to: invitation.email,
        teamName: invitation.organization.name,
        inviterName: inviter?.name || 'Un administrateur',
        invitationToken: token,
      });
    } catch (mailErr) {
      console.error('[RESEND_TEAM_INVITATION] email failed:', mailErr);
      ApiResponse.error(res, "Invitation renouvelée mais l'envoi de l'email a échoué.", 500);
      return;
    }

    ApiResponse.success(res, { id: invitation.id, expiresAt }, 'Invitation renvoyée');
  } catch (error) {
    next(error);
  }
};

// Remove a member from an org (US-TEAM-05 base; full UX in US-TEAM-09). Admin
// only. Refuses to remove the last admin so an org can never end up
// admin-less. Allowing self-removal too — the UI just calls the same endpoint.
export const removeOrganizationMember = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const orgId = String(req.params.orgId || '');
    const memberId = String(req.params.memberId || '');

    const myMembership = await prisma.organizationMember.findFirst({
      where: { organizationId: orgId, userId, status: 'ACTIVE' },
    });
    if (!myMembership) {
      ApiResponse.forbidden(res, "Vous n'êtes pas membre de cette équipe.");
      return;
    }

    const target = await prisma.organizationMember.findFirst({
      where: { id: memberId, organizationId: orgId },
      include: { organization: { select: { name: true } }, user: { select: { id: true, name: true, email: true } } },
    });
    if (!target) {
      ApiResponse.notFound(res, 'Membre introuvable.');
      return;
    }

    // Admin can remove anyone. A regular member can only remove themselves
    // (= leave the org). Anything else is forbidden.
    const isSelfRemoval = target.userId === userId;
    if (myMembership.role !== 'ADMIN' && !isSelfRemoval) {
      ApiResponse.forbidden(res, "Seul l'administrateur peut retirer un membre.");
      return;
    }

    // Block last-admin removal: an org without admin is dead state.
    if (target.role === 'ADMIN') {
      const adminCount = await prisma.organizationMember.count({
        where: { organizationId: orgId, role: 'ADMIN', status: 'ACTIVE' },
      });
      if (adminCount <= 1) {
        ApiResponse.error(
          res,
          isSelfRemoval
            ? "Vous êtes le seul Owner. Transférez l'ownership avant de vous retirer."
            : "Impossible de retirer le seul Owner de l'équipe.",
          409
        );
        return;
      }
    }

    // Cascade: when a user leaves / is removed from an org, drop their
    // ProjectMember rows on every project of that org. Per spec US-TEAM-09:
    // "perdra l'accès à tous les projets auxquels il avait accès dans cette
    // équipe". Personal projects of theirs (orgId NULL) are untouched.
    await prisma.$transaction([
      prisma.projectMember.deleteMany({
        where: {
          userId: target.userId,
          project: { organizationId: orgId },
        },
      }),
      prisma.organizationMember.delete({ where: { id: target.id } }),
    ]);

    // Drop the user's tabs out of the org room — without this they'd keep
    // receiving project:new events for a team they no longer belong to until
    // their next reconnect. Done before the notification so by the time the
    // org:member:removed event fires, the room is already clean.
    socketService.removeUserFromOrgRoom(target.user.id, orgId);

    // In-app + socket notification + email to the removed user. All
    // best-effort: the OrganizationMember row is already deleted, failures
    // here just mean the user might not realise immediately.
    if (!isSelfRemoval) {
      const ownerInfo = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      const ownerName = ownerInfo?.name || "L'administrateur";

      try {
        const notification = await prisma.notification.create({
          data: {
            userId: target.user.id,
            type: 'TEAM_MEMBER_REMOVED',
            title: "Retiré d'une équipe",
            message: `Vous avez été retiré de l'équipe "${target.organization.name}".`,
            link: '/team',
          },
        });
        socketService.emitToUser(target.user.id, 'notification:new', notification);

        // Real-time switcher refresh — the removed user's OrgContext listens
        // for this and drops the org from the dropdown without a page reload.
        socketService.emitToUser(target.user.id, 'org:member:removed', {
          organizationId: orgId,
          organizationName: target.organization.name,
        });
      } catch (notifErr) {
        console.error('[REMOVE_ORG_MEMBER] notification failed (non-fatal):', notifErr);
      }

      try {
        await emailService.sendTeamMemberRemovedEmail(
          target.user.email,
          target.user.name,
          target.organization.name,
          ownerName
        );
      } catch (mailErr) {
        console.error('[REMOVE_ORG_MEMBER] email failed (non-fatal):', mailErr);
      }
    }

    ApiResponse.success(res, null, isSelfRemoval ? 'Vous avez quitté l\'équipe' : 'Membre retiré');
  } catch (error) {
    next(error);
  }
};

// Update the current user's job label inside a given org. Used by the
// onboarding step right after invitation acceptance, AND from the team page
// later if the user wants to change it. Sending null/empty clears the label.
export const updateMyJobLabel = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const orgId = String(req.params.orgId || '');
    const raw = req.body?.jobLabel;
    const jobLabel = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim().slice(0, 80) : null;

    const membership = await prisma.organizationMember.findFirst({
      where: { organizationId: orgId, userId, status: 'ACTIVE' },
    });
    if (!membership) {
      ApiResponse.forbidden(res, "Vous n'êtes pas membre de cette équipe.");
      return;
    }

    await prisma.organizationMember.update({
      where: { id: membership.id },
      data: { jobLabel },
    });

    ApiResponse.success(res, { jobLabel }, jobLabel ? 'Label mis à jour' : 'Label retiré');
  } catch (error) {
    next(error);
  }
};

