import { sendEmail, emailTemplates } from '../config/email';
import { renderEmailFromDB, RenderedEmail } from './templateResolver';

/**
 * Try to render from the DB-backed email_templates table. Falls back to the
 * hardcoded `emailTemplates` object if the DB template doesn't exist. The DB
 * version lets admins tune subject/HTML from the admin UI without redeploy.
 *
 * Returns `{ subject, html, text }` in the shape expected by `sendEmail`.
 */
const resolveTemplate = async (
  name: string,
  vars: Record<string, unknown>,
  fallback: { subject: string; html: string; text: string }
): Promise<{ subject: string; html: string; text: string }> => {
  const dbRendered = await renderEmailFromDB(name, vars);
  if (dbRendered) {
    return {
      subject: dbRendered.subject,
      html: dbRendered.html,
      text: dbRendered.text ?? fallback.text,
    };
  }
  return fallback;
};

interface SendInvitationEmailData {
  to: string;
  projectTitle: string;
  inviterName: string;
  invitationToken: string;
  message?: string;
}

interface SendTeamInvitationEmailData {
  to: string;
  teamName: string;
  inviterName: string;
  invitationToken: string;
}

interface SendTeamMemberNotifyEmailData {
  to: string;
  ownerName: string;
  memberName: string;
  memberEmail: string;
  teamName: string;
  addToProjectUrl: string;
}

export class EmailService {
  /**
   * Send project invitation email
   */
  async sendInvitationEmail(data: SendInvitationEmailData): Promise<void> {
    const {
      to,
      projectTitle,
      inviterName,
      invitationToken,
      message,
    } = data;

    // Build invitation URL (HashRouter requires #/)
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const invitationUrl = `${frontendUrl}/#/accept-invitation?token=${invitationToken}`;

    // DEBUG: Log the invitation URL
    console.log('📧 Sending invitation email to:', to);
    console.log('🔗 Invitation URL:', invitationUrl);
    console.log('📝 Token:', invitationToken);

    const emailTemplate = await resolveTemplate(
      'invitation',
      { email: to, projectTitle, inviterName, invitationUrl, message: message ?? '' },
      emailTemplates.projectInvitation(to, projectTitle, inviterName, invitationUrl, message)
    );

    await sendEmail(to, emailTemplate);
  }

  /**
   * Send team (organisation) invitation email. Lands the user on the same
   * /accept-invitation route as project invites — the route resolver will
   * inspect the token and figure out which type it is.
   */
  async sendTeamInvitationEmail(data: SendTeamInvitationEmailData): Promise<void> {
    const { to, teamName, inviterName, invitationToken } = data;

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const invitationUrl = `${frontendUrl}/#/accept-invitation?token=${invitationToken}&type=team`;

    const emailTemplate = await resolveTemplate(
      'team_invitation',
      { email: to, teamName, inviterName, invitationUrl },
      emailTemplates.teamInvitation(to, teamName, inviterName, invitationUrl)
    );

    await sendEmail(to, emailTemplate);
  }

  /**
   * Notify the team admin/owner that a new member has joined the team. Sent
   * automatically when an invitation is accepted (US-TEAM-04).
   */
  async sendTeamMemberJoinedEmail(data: SendTeamMemberNotifyEmailData): Promise<void> {
    const { to, ownerName, memberName, memberEmail, teamName, addToProjectUrl } = data;
    const emailTemplate = await resolveTemplate(
      'team_member_joined',
      { ownerName, memberName, memberEmail, teamName, addToProjectUrl },
      emailTemplates.teamMemberJoined(ownerName, memberName, memberEmail, teamName, addToProjectUrl)
    );
    await sendEmail(to, emailTemplate);
  }

  /**
   * Notify a user that they were removed from a team (US-TEAM-09). Sent
   * after the OrganizationMember row is deleted. Best-effort — failure to
   * send must not roll back the removal.
   */
  async sendTeamMemberRemovedEmail(
    to: string,
    memberName: string,
    teamName: string,
    ownerName: string
  ): Promise<void> {
    const emailTemplate = await resolveTemplate(
      'team_member_removed',
      { memberName, teamName, ownerName },
      emailTemplates.teamMemberRemoved(memberName, teamName, ownerName)
    );
    await sendEmail(to, emailTemplate);
  }

  /**
   * Notify a user that they were just granted access to a project (US-TEAM-06
   * direct-add flow). Different from the invitation email — there's no token
   * to accept; the membership row is already created.
   */
  async sendProjectAccessGrantedEmail(
    to: string,
    memberName: string,
    ownerName: string,
    projectTitle: string,
    permissionLabel: string,
    workspaceUrl: string
  ): Promise<void> {
    const emailTemplate = await resolveTemplate(
      'project_access_granted',
      { memberName, ownerName, projectTitle, permissionLabel, workspaceUrl },
      emailTemplates.projectAccessGranted(memberName, ownerName, projectTitle, permissionLabel, workspaceUrl)
    );
    await sendEmail(to, emailTemplate);
  }

  /**
   * Notify the team admin/owner that a member is asking to be added to a
   * project. Triggered manually by the member from the empty-state CTA.
   */
  async sendTeamMemberRequestsAccessEmail(data: SendTeamMemberNotifyEmailData): Promise<void> {
    const { to, ownerName, memberName, memberEmail, teamName, addToProjectUrl } = data;
    const emailTemplate = await resolveTemplate(
      'team_member_requests_access',
      { ownerName, memberName, memberEmail, teamName, addToProjectUrl },
      emailTemplates.teamMemberRequestsAccess(ownerName, memberName, memberEmail, teamName, addToProjectUrl)
    );
    await sendEmail(to, emailTemplate);
  }

  /**
   * Send talent assignment notification
   */
  async sendTalentAssignedEmail(
    talentEmail: string,
    talentName: string,
    deliverableTitle: string,
    projectTitle: string,
    workspaceUrl: string
  ): Promise<void> {
    const emailTemplate = await resolveTemplate(
      'talent_assigned',
      { talentName, deliverableTitle, projectTitle, workspaceUrl },
      emailTemplates.talentAssigned(talentName, deliverableTitle, projectTitle, workspaceUrl)
    );
    await sendEmail(talentEmail, emailTemplate);
  }

  /**
   * Send new version notification
   */
  async sendNewVersionEmail(
    clientEmail: string,
    clientName: string,
    deliverableTitle: string,
    projectTitle: string,
    versionNumber: number,
    workspaceUrl: string
  ): Promise<void> {
    const emailTemplate = await resolveTemplate(
      'new_version',
      { clientName, deliverableTitle, projectTitle, versionNumber, workspaceUrl },
      emailTemplates.newVersion(clientName, deliverableTitle, projectTitle, versionNumber, workspaceUrl)
    );
    await sendEmail(clientEmail, emailTemplate);
  }

  /**
   * Send assignment accepted notification
   */
  async sendAssignmentAcceptedEmail(
    clientEmail: string,
    clientName: string,
    talentName: string,
    deliverableTitle: string,
    projectTitle: string,
    workspaceUrl: string
  ): Promise<void> {
    const emailTemplate = await resolveTemplate(
      'assignment_accepted',
      { clientName, talentName, deliverableTitle, projectTitle, workspaceUrl },
      emailTemplates.assignmentAccepted(clientName, talentName, deliverableTitle, projectTitle, workspaceUrl)
    );
    await sendEmail(clientEmail, emailTemplate);
  }

  /**
   * Send assignment rejected notification
   */
  async sendAssignmentRejectedEmail(
    clientEmail: string,
    clientName: string,
    talentName: string,
    deliverableTitle: string,
    projectTitle: string,
    reason: string | null,
    workspaceUrl: string
  ): Promise<void> {
    const emailTemplate = await resolveTemplate(
      'assignment_rejected',
      { clientName, talentName, deliverableTitle, projectTitle, reason: reason ?? '', workspaceUrl },
      emailTemplates.assignmentRejected(clientName, talentName, deliverableTitle, projectTitle, reason, workspaceUrl)
    );
    await sendEmail(clientEmail, emailTemplate);
  }

  /**
   * Send verification email
   */
  async sendVerificationEmail(
    email: string,
    name: string,
    verificationUrl: string
  ): Promise<void> {
    const emailTemplate = await resolveTemplate(
      'verify_email',
      { name, verificationUrl },
      emailTemplates.verification(name, verificationUrl)
    );

    await sendEmail(email, emailTemplate);
  }

  /**
   * Send access request email (to project owner)
   */
  async sendAccessRequestEmail(data: {
    to: string;
    requesterName: string;
    requesterEmail: string;
    projectTitle: string;
    message?: string;
    projectUrl: string;
  }): Promise<void> {
    const { to, requesterName, requesterEmail, projectTitle, message, projectUrl } = data;

    const emailTemplate = await resolveTemplate(
      'access_request',
      { requesterName, requesterEmail, projectTitle, message: message ?? '', projectUrl },
      emailTemplates.accessRequest(requesterName, requesterEmail, projectTitle, message, projectUrl)
    );

    await sendEmail(to, emailTemplate);
  }

  /**
   * Send access approved email
   */
  async sendAccessApprovedEmail(data: {
    to: string;
    projectTitle: string;
  }): Promise<void> {
    const { to, projectTitle } = data;

    const emailTemplate = await resolveTemplate(
      'access_approved',
      { projectTitle },
      emailTemplates.accessApproved(projectTitle)
    );

    await sendEmail(to, emailTemplate);
  }

  /**
   * Send access rejected email
   */
  async sendAccessRejectedEmail(data: {
    to: string;
    projectTitle: string;
  }): Promise<void> {
    const { to, projectTitle } = data;

    const emailTemplate = await resolveTemplate(
      'access_rejected',
      { projectTitle },
      emailTemplates.accessRejected(projectTitle)
    );

    await sendEmail(to, emailTemplate);
  }

  /**
   * Send invitation accepted email (to talent/owner when client accepts and starts onboarding)
   */
  async sendInvitationAcceptedEmail(data: {
    to: string;
    talentName: string;
    clientName: string;
    projectTitle: string;
    projectId: string;
  }): Promise<void> {
    const { to, talentName, clientName, projectTitle, projectId } = data;

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const workspaceUrl = `${frontendUrl}/#/workspace/${projectId}`;

    const emailTemplate = await resolveTemplate(
      'invitation_accepted',
      { talentName, clientName, projectTitle, workspaceUrl },
      emailTemplates.invitationAccepted(talentName, clientName, projectTitle, workspaceUrl)
    );

    await sendEmail(to, emailTemplate);
  }

  /**
   * Send invitation rejected email (to talent/owner when client refuses invitation)
   */
  async sendInvitationRejectedEmail(data: {
    to: string;
    talentName: string;
    clientEmail: string;
    projectTitle: string;
    projectId: string;
    reason?: string;
  }): Promise<void> {
    const { to, talentName, clientEmail, projectTitle, projectId, reason } = data;

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const workspaceUrl = `${frontendUrl}/#/workspace/${projectId}`;

    const emailTemplate = await resolveTemplate(
      'invitation_rejected',
      { talentName, clientEmail, projectTitle, workspaceUrl, reason: reason ?? '' },
      emailTemplates.invitationRejected(talentName, clientEmail, projectTitle, workspaceUrl, reason)
    );

    await sendEmail(to, emailTemplate);
  }

  /**
   * Send beta signup notification to manager
   */
  async sendBetaSignupNotification(data: {
    name: string;
    email: string;
    contact: string;
    role?: string;
    interests?: string[];
    videoCount?: string;
    collaboration?: string;
    biggestProblem?: string;
    feedbackReady?: string;
    link?: string;
    marketplaceInterest?: string;
    source?: string;
    signupNumber?: string;
  }): Promise<void> {
    const {
      name,
      email,
      contact,
      role,
      interests,
      videoCount,
      collaboration,
      biggestProblem,
      feedbackReady,
      link,
      marketplaceInterest,
      source,
      signupNumber,
    } = data;

    // Build admin URL
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const adminUrl = `${frontendUrl}/#/admin/beta-signups`;

    const emailTemplate = await resolveTemplate(
      'beta_signup_notification',
      {
        name,
        email,
        contact,
        role: role ?? '',
        videoCount: videoCount ?? '',
        collaboration: collaboration ?? '',
        biggestProblem: biggestProblem ?? '',
        interests: (interests ?? []).join(', '),
        feedbackReady: feedbackReady ?? '',
        link: link ?? '',
        marketplaceInterest: marketplaceInterest ?? '',
        source: source ?? '',
      },
      emailTemplates.betaSignupNotification(
        name,
        email,
        contact,
        role,
        interests,
        videoCount,
        collaboration,
        biggestProblem,
        feedbackReady,
        link,
        marketplaceInterest,
        source,
        adminUrl,
        signupNumber
      )
    );

    // Send to manager
    const managerEmail = process.env.BETA_MANAGER_EMAIL || 'papeserigne@toftal.com';
    await sendEmail(managerEmail, emailTemplate);
  }

  /**
   * Send beta signup confirmation email to the user
   */
  async sendBetaSignupConfirmation(userEmail: string, userName: string): Promise<void> {
    const emailTemplate = await resolveTemplate(
      'beta_signup_confirmation',
      { name: userName },
      emailTemplates.betaSignupConfirmation(userName)
    );
    await sendEmail(userEmail, emailTemplate);
  }

  /**
   * Send collaborator added email
   */
  async sendCollaboratorAddedEmail(data: {
    to: string;
    collaboratorName: string;
    projectTitle: string;
    projectId: string;
    addedBy: string;
    permissions?: { view?: boolean; edit?: boolean; comment?: boolean; approve?: boolean };
  }): Promise<void> {
    const { to, collaboratorName, projectTitle, projectId, addedBy, permissions } = data;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const permLabels = Object.entries(permissions || {})
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ');

    const emailTemplate = await resolveTemplate(
      'collaborator_added',
      {
        collaboratorName,
        projectTitle,
        addedBy,
        projectId,
        projectUrl: `${frontendUrl}/#/workspace/${projectId}`,
        permissions: permLabels || 'view',
      },
      emailTemplates.collaboratorAdded(collaboratorName, projectTitle, addedBy, projectId, permissions)
    );
    await sendEmail(to, emailTemplate);
  }

  /**
   * Send member role updated email
   */
  async sendMemberRoleUpdatedEmail(data: {
    to: string;
    memberName: string;
    projectTitle: string;
    projectId: string;
    oldRole: string;
    newRole: string;
    updatedBy: string;
  }): Promise<void> {
    const { to, memberName, projectTitle, projectId, oldRole, newRole, updatedBy } = data;
    const emailTemplate = await resolveTemplate(
      'member_role_updated',
      { memberName, projectTitle, projectId, oldRole, newRole, updatedBy },
      emailTemplates.memberRoleUpdated(memberName, projectTitle, projectId, oldRole, newRole, updatedBy)
    );
    await sendEmail(to, emailTemplate);
  }

  /**
   * Send member permissions updated email — used when permissions change but
   * the role doesn't (the role-update template would render an empty/wrong
   * role-change block in that case).
   */
  async sendMemberPermissionsUpdatedEmail(data: {
    to: string;
    memberName: string;
    projectTitle: string;
    projectId: string;
    oldPermissions: { view: boolean; edit: boolean; comment: boolean; approve: boolean };
    newPermissions: { view: boolean; edit: boolean; comment: boolean; approve: boolean };
    updatedBy: string;
  }): Promise<void> {
    const { to, memberName, projectTitle, projectId, oldPermissions, newPermissions, updatedBy } = data;

    // Pre-render the perm strings so DB-template authors can use simple
    // {{oldPermissionsLabel}} / {{newPermissionsLabel}} placeholders without
    // implementing per-key formatting in mustache.
    const PERM_LABELS: Record<string, string> = {
      view: 'Voir',
      comment: 'Commenter',
      edit: 'Modifier',
      approve: 'Approuver',
    };
    const renderPerms = (perms: { view: boolean; edit: boolean; comment: boolean; approve: boolean }) =>
      (['view', 'comment', 'edit', 'approve'] as const)
        .map((k) => `${perms[k] ? '✅' : '❌'} ${PERM_LABELS[k]}`)
        .join(' · ');

    const emailTemplate = await resolveTemplate(
      'member_permissions_updated',
      {
        memberName,
        projectTitle,
        projectId,
        oldPermissionsLabel: renderPerms(oldPermissions),
        newPermissionsLabel: renderPerms(newPermissions),
        updatedBy,
      },
      emailTemplates.memberPermissionsUpdated(memberName, projectTitle, projectId, oldPermissions, newPermissions, updatedBy)
    );
    await sendEmail(to, emailTemplate);
  }

  /**
   * Send video share invitation email
   */
  async sendVideoShareInvitationEmail(data: {
    to: string;
    inviterName: string;
    videoTitle: string;
    shareUrl: string;
    permission: 'view' | 'comment' | 'download';
    message?: string;
  }): Promise<void> {
    const { to, inviterName, videoTitle, shareUrl, permission, message } = data;
    const emailTemplate = await resolveTemplate(
      'video_share_invitation',
      { to, inviterName, videoTitle, shareUrl, permission, message: message ?? '' },
      emailTemplates.videoShareInvitation(to, inviterName, videoTitle, shareUrl, permission, message)
    );
    await sendEmail(to, emailTemplate);
  }

  /**
   * Send ownership transfer request email
   */
  async sendOwnershipTransferRequestEmail(data: {
    to: string;
    recipientName: string;
    senderName: string;
    projectTitle: string;
    projectId: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    const { to, recipientName, senderName, projectTitle, projectId, token, expiresAt } = data;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const acceptUrl = `${frontendUrl}/#/accept-transfer/${token}`;

    const emailTemplate = await resolveTemplate(
      'ownership_transfer_request',
      { recipientName, senderName, projectTitle, acceptUrl, expiresAt: expiresAt.toISOString() },
      emailTemplates.ownershipTransferRequest(recipientName, senderName, projectTitle, acceptUrl, expiresAt)
    );
    await sendEmail(to, emailTemplate);
  }

  /**
   * Send ownership transfer accepted email
   */
  async sendOwnershipTransferAcceptedEmail(data: {
    to: string;
    oldOwnerName: string;
    newOwnerName: string;
    projectTitle: string;
    projectId: string;
  }): Promise<void> {
    const { to, oldOwnerName, newOwnerName, projectTitle, projectId } = data;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const workspaceUrl = `${frontendUrl}/#/workspace/${projectId}`;

    const emailTemplate = await resolveTemplate(
      'ownership_transfer_accepted',
      { oldOwnerName, newOwnerName, projectTitle, workspaceUrl },
      emailTemplates.ownershipTransferAccepted(oldOwnerName, newOwnerName, projectTitle, workspaceUrl)
    );
    await sendEmail(to, emailTemplate);
  }

  /**
   * Send ownership transfer rejected email
   */
  async sendOwnershipTransferRejectedEmail(data: {
    to: string;
    oldOwnerName: string;
    newOwnerName: string;
    projectTitle: string;
    reason?: string;
  }): Promise<void> {
    const { to, oldOwnerName, newOwnerName, projectTitle, reason } = data;

    const emailTemplate = await resolveTemplate(
      'ownership_transfer_rejected',
      { oldOwnerName, newOwnerName, projectTitle, reason: reason ?? '' },
      emailTemplates.ownershipTransferRejected(oldOwnerName, newOwnerName, projectTitle, reason)
    );
    await sendEmail(to, emailTemplate);
  }
}
