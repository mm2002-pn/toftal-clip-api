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
}
