import { sendEmail, emailTemplates } from '../config/email';

interface SendInvitationEmailData {
  to: string;
  projectTitle: string;
  inviterName: string;
  invitationToken: string;
  message?: string;
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

    // Get email template
    const emailTemplate = emailTemplates.projectInvitation(
      to,
      projectTitle,
      inviterName,
      invitationUrl,
      message
    );

    // Send email
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
    const emailTemplate = emailTemplates.talentAssigned(
      talentName,
      deliverableTitle,
      projectTitle,
      workspaceUrl
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
    const emailTemplate = emailTemplates.newVersion(
      clientName,
      deliverableTitle,
      projectTitle,
      versionNumber,
      workspaceUrl
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
    const emailTemplate = emailTemplates.assignmentAccepted(
      clientName,
      talentName,
      deliverableTitle,
      projectTitle,
      workspaceUrl
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
    const emailTemplate = emailTemplates.assignmentRejected(
      clientName,
      talentName,
      deliverableTitle,
      projectTitle,
      reason,
      workspaceUrl
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
    const emailTemplate = emailTemplates.verification(name, verificationUrl);

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

    const emailTemplate = emailTemplates.accessRequest(
      requesterName,
      requesterEmail,
      projectTitle,
      message,
      projectUrl
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

    const emailTemplate = emailTemplates.accessApproved(projectTitle);

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

    const emailTemplate = emailTemplates.accessRejected(projectTitle);

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

    const emailTemplate = emailTemplates.invitationAccepted(
      talentName,
      clientName,
      projectTitle,
      workspaceUrl
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

    const emailTemplate = emailTemplates.invitationRejected(
      talentName,
      clientEmail,
      projectTitle,
      workspaceUrl,
      reason
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

    const emailTemplate = emailTemplates.betaSignupNotification(
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
    );

    // Send to manager
    const managerEmail = process.env.BETA_MANAGER_EMAIL || 'papeserigne@toftal.com';
    await sendEmail(managerEmail, emailTemplate);
  }

  /**
   * Send beta signup confirmation email to the user
   */
  async sendBetaSignupConfirmation(userEmail: string, userName: string): Promise<void> {
    const emailTemplate = emailTemplates.betaSignupConfirmation(userName);
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
    const emailTemplate = emailTemplates.collaboratorAdded(
      collaboratorName,
      projectTitle,
      addedBy,
      projectId,
      permissions
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
    const emailTemplate = emailTemplates.memberRoleUpdated(
      memberName,
      projectTitle,
      projectId,
      oldRole,
      newRole,
      updatedBy
    );
    await sendEmail(to, emailTemplate);
  }
}
