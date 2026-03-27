import nodemailer from 'nodemailer';
import { config } from './index';

// Create transporter
// For development: use Ethereal (fake SMTP) or Gmail
// For production: use a real SMTP service (SendGrid, Mailgun, etc.)

const createTransporter = () => {
  // Gmail configuration
  if (process.env.EMAIL_SERVICE === 'gmail') {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD, // Use App Password for Gmail
      },
    });
  }

  // Custom SMTP configuration
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }

  // Development: use Ethereal (fake SMTP for testing)
  // Emails won't be sent but can be viewed at https://ethereal.email
  console.warn('⚠️ No email configuration found. Using Ethereal for development.');
  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    auth: {
      user: process.env.ETHEREAL_USER || '',
      pass: process.env.ETHEREAL_PASS || '',
    },
  });
};

export const transporter = createTransporter();

// Base email wrapper with dark theme matching the app
const emailWrapper = (content: string, headerTitle: string, headerEmoji: string = '') => `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${headerTitle}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #080808; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #080808; padding: 40px 20px;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="background-color: #121212; border-radius: 16px; overflow: hidden; border: 1px solid #27272A;">
            <!-- Header -->
            <tr>
              <td style="background: linear-gradient(135deg, #E91E63 0%, #C2185B 100%); padding: 40px; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 28px; font-weight: bold;">${headerEmoji} ${headerTitle}</h1>
              </td>
            </tr>

            <!-- Content -->
            <tr>
              <td style="padding: 40px;">
                ${content}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding: 24px 40px; border-top: 1px solid #27272A; text-align: center;">
                <p style="color: #71717A; font-size: 12px; margin: 0;">
                  © ${new Date().getFullYear()} Toftal Clip. Tous droits réservés.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
`;

// Email templates
export const emailTemplates = {
  // Assignment notification - sent to talent when assigned to a deliverable
  talentAssigned: (talentName: string, deliverableTitle: string, projectTitle: string, workspaceUrl: string) => ({
    subject: `Nouvelle mission assignée - ${projectTitle}`,
    html: emailWrapper(`
      <h2 style="color: #FAFAFA; margin: 0 0 16px 0; font-size: 24px;">Bonjour ${talentName} !</h2>
      <p style="color: #A1A1AA; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
        Vous avez été assigné à une nouvelle vidéo sur Toftal Clip.
      </p>

      <!-- Mission Details -->
      <div style="background-color: #18181B; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #27272A;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 8px 0;">
              <span style="color: #71717A; font-size: 12px; text-transform: uppercase;">Projet</span>
              <p style="color: #FAFAFA; font-size: 18px; font-weight: 600; margin: 4px 0 0 0;">${projectTitle}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-top: 1px solid #27272A;">
              <span style="color: #71717A; font-size: 12px; text-transform: uppercase;">Vidéo</span>
              <p style="color: #FAFAFA; font-size: 18px; font-weight: 600; margin: 4px 0 0 0;">${deliverableTitle}</p>
            </td>
          </tr>
        </table>
      </div>

      <!-- Button -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="padding: 24px 0;">
            <a href="${workspaceUrl}" style="display: inline-block; background: linear-gradient(135deg, #E91E63 0%, #C2185B 100%); color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Voir la mission
            </a>
          </td>
        </tr>
      </table>

      <p style="color: #71717A; font-size: 14px; line-height: 1.6; margin: 24px 0 0 0; text-align: center;">
        Connectez-vous pour accepter ou refuser cette mission.
      </p>
    `, 'Nouvelle Mission', '🎬'),
    text: `
      Bonjour ${talentName} !

      Vous avez été assigné à une nouvelle vidéo sur Toftal Clip.

      Projet: ${projectTitle}
      Vidéo: ${deliverableTitle}

      Connectez-vous pour accepter ou refuser cette mission: ${workspaceUrl}

      - L'équipe Toftal Clip
    `,
  }),

  // Unassignment notification - sent to talent when unassigned from a deliverable
  talentUnassigned: (talentName: string, deliverableTitle: string, projectTitle: string, workspaceUrl: string) => ({
    subject: `Assignation retirée - ${projectTitle}`,
    html: emailWrapper(`
      <h2 style="color: #FAFAFA; margin: 0 0 16px 0; font-size: 24px;">Bonjour ${talentName},</h2>
      <p style="color: #A1A1AA; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
        Votre assignation à une vidéo a été retirée.
      </p>

      <!-- Mission Details -->
      <div style="background-color: #18181B; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #27272A;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 8px 0;">
              <span style="color: #71717A; font-size: 12px; text-transform: uppercase;">Projet</span>
              <p style="color: #FAFAFA; font-size: 18px; font-weight: 600; margin: 4px 0 0 0;">${projectTitle}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-top: 1px solid #27272A;">
              <span style="color: #71717A; font-size: 12px; text-transform: uppercase;">Vidéo</span>
              <p style="color: #FAFAFA; font-size: 18px; font-weight: 600; margin: 4px 0 0 0;">${deliverableTitle}</p>
            </td>
          </tr>
        </table>
      </div>

      <p style="color: #A1A1AA; font-size: 14px; line-height: 1.6; margin: 24px 0;">
        Vous n'êtes plus assigné à cette vidéo. Si vous avez des questions, veuillez contacter le responsable du projet.
      </p>

      <!-- Button -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="padding: 24px 0;">
            <a href="${workspaceUrl}" style="display: inline-block; background: linear-gradient(135deg, #E91E63 0%, #C2185B 100%); color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Voir le projet
            </a>
          </td>
        </tr>
      </table>
    `, 'Assignation Retirée', 'ℹ️'),
    text: `
      Bonjour ${talentName},

      Votre assignation à une vidéo a été retirée.

      Projet: ${projectTitle}
      Vidéo: ${deliverableTitle}

      Si vous avez des questions, veuillez contacter le responsable du projet: ${workspaceUrl}

      - L'équipe Toftal Clip
    `,
  }),

  // New version notification - sent to client when talent uploads a version
  newVersion: (clientName: string, deliverableTitle: string, projectTitle: string, versionNumber: number, workspaceUrl: string) => ({
    subject: `Nouvelle version disponible - ${deliverableTitle}`,
    html: emailWrapper(`
      <h2 style="color: #FAFAFA; margin: 0 0 16px 0; font-size: 24px;">Bonjour ${clientName} !</h2>
      <p style="color: #A1A1AA; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
        Une nouvelle version de votre vidéo est prête pour review.
      </p>

      <!-- Version Details -->
      <div style="background-color: #18181B; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #27272A;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 8px 0;">
              <span style="color: #71717A; font-size: 12px; text-transform: uppercase;">Projet</span>
              <p style="color: #FAFAFA; font-size: 18px; font-weight: 600; margin: 4px 0 0 0;">${projectTitle}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-top: 1px solid #27272A;">
              <span style="color: #71717A; font-size: 12px; text-transform: uppercase;">Vidéo</span>
              <p style="color: #FAFAFA; font-size: 18px; font-weight: 600; margin: 4px 0 0 0;">${deliverableTitle}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-top: 1px solid #27272A;">
              <span style="color: #71717A; font-size: 12px; text-transform: uppercase;">Version</span>
              <p style="color: #E91E63; font-size: 24px; font-weight: 700; margin: 4px 0 0 0;">V${versionNumber}</p>
            </td>
          </tr>
        </table>
      </div>

      <!-- Button -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="padding: 24px 0;">
            <a href="${workspaceUrl}" style="display: inline-block; background: linear-gradient(135deg, #E91E63 0%, #C2185B 100%); color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Voir & Commenter
            </a>
          </td>
        </tr>
      </table>
    `, `Version ${versionNumber} Disponible`, '🎥'),
    text: `
      Bonjour ${clientName} !

      Une nouvelle version de votre vidéo est prête pour review.

      Projet: ${projectTitle}
      Vidéo: ${deliverableTitle}
      Version: V${versionNumber}

      Voir & Commenter: ${workspaceUrl}

      - L'équipe Toftal Clip
    `,
  }),

  // Assignment accepted - sent to client when talent accepts
  assignmentAccepted: (clientName: string, talentName: string, deliverableTitle: string, projectTitle: string, workspaceUrl: string) => ({
    subject: `Mission acceptée - ${deliverableTitle}`,
    html: emailWrapper(`
      <h2 style="color: #FAFAFA; margin: 0 0 16px 0; font-size: 24px;">Excellente nouvelle ${clientName} !</h2>
      <p style="color: #A1A1AA; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
        <strong style="color: #22C55E;">${talentName}</strong> a accepté de travailler sur votre vidéo.
      </p>

      <!-- Details -->
      <div style="background-color: #18181B; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #27272A;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 8px 0;">
              <span style="color: #71717A; font-size: 12px; text-transform: uppercase;">Projet</span>
              <p style="color: #FAFAFA; font-size: 18px; font-weight: 600; margin: 4px 0 0 0;">${projectTitle}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-top: 1px solid #27272A;">
              <span style="color: #71717A; font-size: 12px; text-transform: uppercase;">Vidéo</span>
              <p style="color: #FAFAFA; font-size: 18px; font-weight: 600; margin: 4px 0 0 0;">${deliverableTitle}</p>
            </td>
          </tr>
        </table>
      </div>

      <!-- Button -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="padding: 24px 0;">
            <a href="${workspaceUrl}" style="display: inline-block; background: linear-gradient(135deg, #E91E63 0%, #C2185B 100%); color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Voir le projet
            </a>
          </td>
        </tr>
      </table>
    `, 'Mission Acceptée', '✅'),
    text: `
      Excellente nouvelle ${clientName} !

      ${talentName} a accepté de travailler sur votre vidéo.

      Projet: ${projectTitle}
      Vidéo: ${deliverableTitle}

      Voir le projet: ${workspaceUrl}

      - L'équipe Toftal Clip
    `,
  }),

  // Assignment rejected - sent to client when talent rejects
  assignmentRejected: (clientName: string, talentName: string, deliverableTitle: string, projectTitle: string, reason: string | null, workspaceUrl: string) => ({
    subject: `Mission refusée - ${deliverableTitle}`,
    html: emailWrapper(`
      <h2 style="color: #FAFAFA; margin: 0 0 16px 0; font-size: 24px;">Bonjour ${clientName},</h2>
      <p style="color: #A1A1AA; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
        ${talentName} n'a pas pu accepter cette mission.
      </p>

      ${reason ? `
      <div style="background-color: #18181B; border-left: 4px solid #EF4444; padding: 16px; margin-bottom: 24px; border-radius: 0 8px 8px 0;">
        <p style="color: #A1A1AA; font-size: 14px; margin: 0;"><strong style="color: #FAFAFA;">Raison:</strong> ${reason}</p>
      </div>
      ` : ''}

      <!-- Details -->
      <div style="background-color: #18181B; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #27272A;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 8px 0;">
              <span style="color: #71717A; font-size: 12px; text-transform: uppercase;">Projet</span>
              <p style="color: #FAFAFA; font-size: 18px; font-weight: 600; margin: 4px 0 0 0;">${projectTitle}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-top: 1px solid #27272A;">
              <span style="color: #71717A; font-size: 12px; text-transform: uppercase;">Vidéo</span>
              <p style="color: #FAFAFA; font-size: 18px; font-weight: 600; margin: 4px 0 0 0;">${deliverableTitle}</p>
            </td>
          </tr>
        </table>
      </div>

      <p style="color: #A1A1AA; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
        Vous pouvez assigner un autre talent à cette vidéo depuis votre espace projet.
      </p>

      <!-- Button -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="padding: 24px 0;">
            <a href="${workspaceUrl}" style="display: inline-block; background: linear-gradient(135deg, #E91E63 0%, #C2185B 100%); color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Trouver un autre talent
            </a>
          </td>
        </tr>
      </table>
    `, 'Mission Refusée', ''),
    text: `
      Bonjour ${clientName},

      ${talentName} n'a pas pu accepter cette mission.
      ${reason ? `Raison: ${reason}` : ''}

      Projet: ${projectTitle}
      Vidéo: ${deliverableTitle}

      Vous pouvez assigner un autre talent depuis: ${workspaceUrl}

      - L'équipe Toftal Clip
    `,
  }),

  projectInvitation: (email: string, projectTitle: string, inviterName: string, invitationUrl: string, message?: string) => ({
    subject: `Vous êtes invité à rejoindre "${projectTitle}" sur Toftal Clip`,
    html: emailWrapper(`
      <h2 style="color: #FAFAFA; margin: 0 0 16px 0; font-size: 24px;">Bonjour !</h2>
      <p style="color: #A1A1AA; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
        <strong style="color: #FAFAFA;">${inviterName}</strong> vous invite à rejoindre un projet collaboratif sur Toftal Clip.
      </p>

      <!-- Project Details -->
      <div style="background-color: #18181B; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #27272A;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 8px 0;">
              <span style="color: #71717A; font-size: 12px; text-transform: uppercase;">Projet</span>
              <p style="color: #FAFAFA; font-size: 20px; font-weight: 600; margin: 4px 0 0 0;">${projectTitle}</p>
            </td>
          </tr>
          ${message ? `
          <tr>
            <td style="padding: 16px 0; border-top: 1px solid #27272A;">
              <span style="color: #71717A; font-size: 12px; text-transform: uppercase;">Message</span>
              <p style="color: #A1A1AA; font-size: 14px; margin: 4px 0 0 0; font-style: italic;">"${message}"</p>
            </td>
          </tr>
          ` : ''}
        </table>
      </div>

      <p style="color: #A1A1AA; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
        Cliquez sur le bouton ci-dessous pour accepter l'invitation et rejoindre le projet. Vous pourrez collaborer avec l'équipe sur le contenu vidéo.
      </p>

      <!-- Button -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="padding: 24px 0;">
            <a href="${invitationUrl}" style="display: inline-block; background: linear-gradient(135deg, #E91E63 0%, #C2185B 100%); color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Voir l'Invitation
            </a>
          </td>
        </tr>
      </table>

      <p style="color: #71717A; font-size: 12px; line-height: 1.6; margin: 24px 0 0 0;">
        Ce lien expire dans <strong style="color: #A1A1AA;">7 jours</strong>.
      </p>

      <!-- Link fallback -->
      <div style="margin-top: 32px; padding: 16px; background-color: #18181B; border-radius: 8px; border: 1px solid #27272A;">
        <p style="color: #71717A; font-size: 12px; margin: 0 0 8px 0;">
          Si le bouton ne fonctionne pas, copiez ce lien :
        </p>
        <p style="color: #E91E63; font-size: 12px; word-break: break-all; margin: 0;">
          ${invitationUrl}
        </p>
      </div>
    `, 'Vous êtes Invité !', '✋'),
    text: `
      Bonjour !

      ${inviterName} vous invite à rejoindre un projet collaboratif sur Toftal Clip.

      Projet: ${projectTitle}
      ${message ? `Message: "${message}"` : ''}

      Cliquez sur le lien ci-dessous pour accepter l'invitation :
      ${invitationUrl}

      Ce lien expire dans 7 jours.

      - L'équipe Toftal Clip
    `,
  }),

  verification: (name: string, verificationUrl: string) => ({
    subject: 'Vérifiez votre email - Toftal Clip',
    html: emailWrapper(`
      <h2 style="color: #FAFAFA; margin: 0 0 16px 0; font-size: 24px;">Bienvenue ${name} !</h2>
      <p style="color: #A1A1AA; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
        Merci de vous être inscrit sur Toftal Clip. Pour activer votre compte et commencer à utiliser notre plateforme, veuillez vérifier votre adresse email.
      </p>

      <!-- Button -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="padding: 24px 0;">
            <a href="${verificationUrl}" style="display: inline-block; background: linear-gradient(135deg, #E91E63 0%, #C2185B 100%); color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Vérifier mon email
            </a>
          </td>
        </tr>
      </table>

      <p style="color: #71717A; font-size: 14px; line-height: 1.6; margin: 24px 0 0 0;">
        Ce lien expire dans <strong style="color: #A1A1AA;">24 heures</strong>.
      </p>

      <p style="color: #71717A; font-size: 14px; line-height: 1.6; margin: 16px 0 0 0;">
        Si vous n'avez pas créé de compte, vous pouvez ignorer cet email.
      </p>

      <!-- Link fallback -->
      <div style="margin-top: 32px; padding: 16px; background-color: #18181B; border-radius: 8px; border: 1px solid #27272A;">
        <p style="color: #71717A; font-size: 12px; margin: 0 0 8px 0;">
          Si le bouton ne fonctionne pas, copiez ce lien :
        </p>
        <p style="color: #E91E63; font-size: 12px; word-break: break-all; margin: 0;">
          ${verificationUrl}
        </p>
      </div>
    `, 'Toftal Clip', ''),
    text: `
      Bienvenue ${name} !

      Merci de vous être inscrit sur Toftal Clip. Pour activer votre compte, veuillez vérifier votre adresse email en cliquant sur le lien ci-dessous :

      ${verificationUrl}

      Ce lien expire dans 24 heures.

      Si vous n'avez pas créé de compte, vous pouvez ignorer cet email.

      - L'équipe Toftal Clip
    `,
  }),

  // Forgot password - send OTP for password reset
  forgotPassword: (name: string, otp: string) => ({
    subject: 'Code de réinitialisation de mot de passe - Toftal Clip',
    html: emailWrapper(`
      <h2 style="color: #FAFAFA; margin: 0 0 16px 0; font-size: 24px;">Réinitialiser votre mot de passe</h2>
      <p style="color: #A1A1AA; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
        Nous avons reçu une demande de réinitialisation de votre mot de passe. Utilisez le code ci-dessous pour continuer.
      </p>

      <!-- OTP Code -->
      <div style="background-color: #18181B; border-radius: 12px; padding: 32px; margin: 32px 0; border: 1px solid #27272A; text-align: center;">
        <p style="color: #71717A; font-size: 12px; margin: 0 0 16px 0; text-transform: uppercase;">Votre code OTP</p>
        <p style="color: #FAFAFA; font-size: 48px; font-weight: bold; letter-spacing: 12px; margin: 0; font-family: monospace;">${otp}</p>
      </div>

      <p style="color: #A1A1AA; font-size: 14px; line-height: 1.6; margin: 24px 0;">
        Ce code expire dans <strong style="color: #FAFAFA;">15 minutes</strong>. Ne partagez jamais ce code avec quelqu'un d'autre.
      </p>

      <p style="color: #71717A; font-size: 14px; line-height: 1.6; margin: 16px 0 0 0;">
        Si vous n'avez pas demandé une réinitialisation de mot de passe, vous pouvez ignorer cet email. Votre compte reste sécurisé.
      </p>
    `, 'Réinitialiser le mot de passe', '🔐'),
    text: `
      Réinitialiser votre mot de passe

      Nous avons reçu une demande de réinitialisation de votre mot de passe. Utilisez le code ci-dessous pour continuer.

      Code OTP: ${otp}

      Ce code expire dans 15 minutes.

      Si vous n'avez pas demandé une réinitialisation de mot de passe, vous pouvez ignorer cet email.

      - L'équipe Toftal Clip
    `,
  }),

  // Access request - sent to project owner when someone requests access
  accessRequest: (requesterName: string, requesterEmail: string, projectTitle: string, message?: string, projectUrl?: string) => ({
    subject: `Demande d'accès - ${projectTitle}`,
    html: emailWrapper(`
      <h2 style="color: #FAFAFA; margin: 0 0 16px 0; font-size: 24px;">Nouvelle demande d'accès</h2>
      <p style="color: #A1A1AA; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
        <strong style="color: #FAFAFA;">${requesterName}</strong> a demandé l'accès à votre projet.
      </p>

      <div style="background-color: #18181B; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #27272A;">
        <p style="color: #FAFAFA; font-weight: 600; margin: 0 0 8px 0;">Projet: ${projectTitle}</p>
        <p style="color: #A1A1AA; font-size: 14px; margin: 0 0 8px 0;">Email: ${requesterEmail}</p>
        ${message ? `<p style="color: #A1A1AA; font-size: 14px; margin: 0; font-style: italic;">Message: "${message}"</p>` : ''}
      </div>

      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="padding: 24px 0;">
            <a href="${projectUrl}" style="display: inline-block; background: linear-gradient(135deg, #E91E63 0%, #C2185B 100%); color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Voir les demandes
            </a>
          </td>
        </tr>
      </table>
    `, 'Demande d\'accès', '🔐'),
    text: `Nouvelle demande d'accès\n\n${requesterName} a demandé l'accès à votre projet "${projectTitle}".\n\nEmail: ${requesterEmail}\n${message ? `Message: "${message}"\n` : ''}Consultez votre espace pour approuver ou refuser la demande.`,
  }),

  // Access approved - sent to requester when access is approved
  accessApproved: (projectTitle: string) => ({
    subject: `Accès approuvé - ${projectTitle}`,
    html: emailWrapper(`
      <h2 style="color: #FAFAFA; margin: 0 0 16px 0; font-size: 24px;">Bienvenue ! 🎉</h2>
      <p style="color: #A1A1AA; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
        Votre demande d'accès au projet <strong style="color: #FAFAFA;">${projectTitle}</strong> a été approuvée.
      </p>
      <p style="color: #A1A1AA; font-size: 14px; line-height: 1.6;">
        Vous avez maintenant accès complet au projet. Vous pouvez éditer les vidéos, commenter et contribuer au succès du projet.
      </p>
    `, 'Accès approuvé', '✅'),
    text: `Votre demande d'accès au projet "${projectTitle}" a été approuvée. Vous avez maintenant accès complet au projet.`,
  }),

  // Access rejected - sent to requester when access is rejected
  accessRejected: (projectTitle: string) => ({
    subject: `Demande d'accès refusée - ${projectTitle}`,
    html: emailWrapper(`
      <h2 style="color: #FAFAFA; margin: 0 0 16px 0; font-size: 24px;">Demande refusée</h2>
      <p style="color: #A1A1AA; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
        Votre demande d'accès au projet <strong style="color: #FAFAFA;">${projectTitle}</strong> a été refusée.
      </p>
      <p style="color: #A1A1AA; font-size: 14px; line-height: 1.6;">
        Vous pouvez contacter le créateur du projet pour plus d'informations.
      </p>
    `, 'Demande refusée', '❌'),
    text: `Votre demande d'accès au projet "${projectTitle}" a été refusée.`,
  }),

  // Invitation accepted - sent to talent/owner when client accepts invitation and starts onboarding
  invitationAccepted: (talentName: string, clientName: string, projectTitle: string, workspaceUrl: string) => ({
    subject: `🎉 ${clientName} a rejoint votre projet - ${projectTitle}`,
    html: emailWrapper(`
      <h2 style="color: #FAFAFA; margin: 0 0 16px 0; font-size: 24px;">Excellente nouvelle ${talentName} !</h2>
      <p style="color: #A1A1AA; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
        <strong style="color: #22C55E;">${clientName}</strong> a accepté votre invitation et rejoint le projet.
      </p>

      <!-- Project Details -->
      <div style="background-color: #18181B; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #27272A;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 8px 0;">
              <span style="color: #71717A; font-size: 12px; text-transform: uppercase;">Projet</span>
              <p style="color: #FAFAFA; font-size: 18px; font-weight: 600; margin: 4px 0 0 0;">${projectTitle}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-top: 1px solid #27272A;">
              <span style="color: #71717A; font-size: 12px; text-transform: uppercase;">Statut</span>
              <p style="color: #F59E0B; font-size: 16px; font-weight: 600; margin: 4px 0 0 0;">⏳ Onboarding en cours</p>
            </td>
          </tr>
        </table>
      </div>

      <p style="color: #A1A1AA; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
        Le client est en train de compléter le brief du projet et d'ajouter les vidéos à créer. Vous serez notifié dès que l'onboarding sera terminé.
      </p>

      <!-- Button -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="padding: 24px 0;">
            <a href="${workspaceUrl}" style="display: inline-block; background: linear-gradient(135deg, #E91E63 0%, #C2185B 100%); color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Voir le projet
            </a>
          </td>
        </tr>
      </table>
    `, 'Invitation Acceptée', '🎉'),
    text: `
      Excellente nouvelle ${talentName} !

      ${clientName} a accepté votre invitation et rejoint le projet "${projectTitle}".

      Le client est en train de compléter le brief du projet (onboarding en cours).
      Vous serez notifié dès que l'onboarding sera terminé.

      Voir le projet: ${workspaceUrl}

      - L'équipe Toftal Clip
    `,
  }),

  // Invitation rejected - sent to talent/owner when client refuses invitation
  invitationRejected: (talentName: string, clientEmail: string, projectTitle: string, workspaceUrl: string, reason?: string) => ({
    subject: `❌ Invitation refusée - ${projectTitle}`,
    html: emailWrapper(`
      <h2 style="color: #FAFAFA; margin: 0 0 16px 0; font-size: 24px;">Invitation refusée</h2>
      <p style="color: #A1A1AA; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
        Bonjour ${talentName},
      </p>
      <p style="color: #A1A1AA; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
        <strong style="color: #EF4444;">${clientEmail}</strong> a refusé l'invitation pour le projet <strong style="color: #FAFAFA;">${projectTitle}</strong>.
      </p>

      <!-- Project Details -->
      <div style="background-color: #18181B; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #27272A;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding: 8px 0;">
              <span style="color: #71717A; font-size: 12px; text-transform: uppercase;">Projet</span>
              <p style="color: #FAFAFA; font-size: 18px; font-weight: 600; margin: 4px 0 0 0;">${projectTitle}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-top: 1px solid #27272A;">
              <span style="color: #71717A; font-size: 12px; text-transform: uppercase;">Email du client</span>
              <p style="color: #FAFAFA; font-size: 16px; margin: 4px 0 0 0;">${clientEmail}</p>
            </td>
          </tr>
          ${reason ? `
          <tr>
            <td style="padding: 8px 0; border-top: 1px solid #27272A;">
              <span style="color: #71717A; font-size: 12px; text-transform: uppercase;">Motif du refus</span>
              <p style="color: #FAFAFA; font-size: 16px; margin: 4px 0 0 0; font-style: italic;">"${reason}"</p>
            </td>
          </tr>
          ` : ''}
        </table>
      </div>

      <p style="color: #A1A1AA; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
        Vous pouvez contacter le client directement pour comprendre les raisons de ce refus, ou inviter un autre client pour ce projet.
      </p>

      <!-- Button -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="padding: 24px 0;">
            <a href="${workspaceUrl}" style="display: inline-block; background: linear-gradient(135deg, #E91E63 0%, #C2185B 100%); color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Voir le projet
            </a>
          </td>
        </tr>
      </table>
    `, 'Invitation Refusée', '❌'),
    text: `
      Bonjour ${talentName},

      ${clientEmail} a refusé l'invitation pour le projet "${projectTitle}".

      ${reason ? `Motif du refus: "${reason}"` : ''}

      Vous pouvez contacter le client directement pour comprendre les raisons de ce refus, ou inviter un autre client pour ce projet.

      Voir le projet: ${workspaceUrl}

      - L'équipe Toftal Clip
    `,
  }),

  // Beta signup notification - sent to manager when new signup
  betaSignupNotification: (
    name: string,
    email: string,
    contact: string,
    role?: string,
    interests?: string[],
    videoCount?: string,
    collaboration?: string,
    biggestProblem?: string,
    feedbackReady?: string,
    link?: string,
    marketplaceInterest?: string,
    source?: string,
    adminUrl?: string,
    signupNumber?: string
  ) => {
    const baseAdminUrl = adminUrl || 'http://localhost:5173/#/admin/beta-signups';
    const signupNum = signupNumber || 'N/A';

    return {
      subject: `🎉 Nouvelle inscription bêta - ${name}`,
      html: emailWrapper(`
        <div style="text-align: center; margin-bottom: 24px;">
          <p style="color: #71717A; font-size: 14px; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 2px;">Inscription N°</p>
          <h2 style="color: #E91E63; margin: 0; font-size: 48px; font-weight: 700;">${signupNum}</h2>
        </div>

        <h2 style="color: #FAFAFA; margin: 0 0 16px 0; font-size: 24px;">Nouvelle inscription bêta 🎉</h2>
        <p style="color: #A1A1AA; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
          Une nouvelle personne s'est inscrite à la bêta de Toftal Clip. Voici tous les détails :
        </p>

        <!-- Infos de Base -->
        <div style="background-color: #18181B; border-radius: 12px; padding: 24px; margin: 32px 0; border: 1px solid #27272A;">
          <h3 style="color: #FAFAFA; font-size: 16px; margin: 0 0 16px 0; border-bottom: 1px solid #27272A; padding-bottom: 12px;">📋 Informations Personnelles</h3>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding: 12px 0;">
                <span style="color: #71717A; font-size: 12px; text-transform: uppercase; font-weight: 600;">Nom</span>
                <p style="color: #FAFAFA; font-size: 16px; font-weight: 600; margin: 4px 0 0 0;">${name}</p>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-top: 1px solid #27272A;">
                <span style="color: #71717A; font-size: 12px; text-transform: uppercase; font-weight: 600;">Contact</span>
                <p style="color: #E91E63; font-size: 16px; margin: 4px 0 0 0;">${contact}</p>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-top: 1px solid #27272A;">
                <span style="color: #71717A; font-size: 12px; text-transform: uppercase; font-weight: 600;">Email Backend</span>
                <p style="color: #A1A1AA; font-size: 14px; margin: 4px 0 0 0; word-break: break-all;">${email}</p>
              </td>
            </tr>
          </table>
        </div>

        <!-- Détails Professionnels -->
        <div style="background-color: #18181B; border-radius: 12px; padding: 24px; margin: 32px 0; border: 1px solid #27272A;">
          <h3 style="color: #FAFAFA; font-size: 16px; margin: 0 0 16px 0; border-bottom: 1px solid #27272A; padding-bottom: 12px;">💼 Détails Professionnels</h3>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${role ? `
            <tr>
              <td style="padding: 12px 0;">
                <span style="color: #71717A; font-size: 12px; text-transform: uppercase; font-weight: 600;">Rôle</span>
                <p style="color: #FAFAFA; font-size: 16px; margin: 4px 0 0 0;">${role}</p>
              </td>
            </tr>
            ` : ''}
            ${videoCount ? `
            <tr style="${role ? 'border-top: 1px solid #27272A;' : ''}">
              <td style="padding: 12px 0;">
                <span style="color: #71717A; font-size: 12px; text-transform: uppercase; font-weight: 600;">Vidéos/Mois</span>
                <p style="color: #FAFAFA; font-size: 16px; margin: 4px 0 0 0;">${videoCount}</p>
              </td>
            </tr>
            ` : ''}
            ${collaboration ? `
            <tr style="${role || videoCount ? 'border-top: 1px solid #27272A;' : ''}">
              <td style="padding: 12px 0;">
                <span style="color: #71717A; font-size: 12px; text-transform: uppercase; font-weight: 600;">Collaboration</span>
                <p style="color: #FAFAFA; font-size: 16px; margin: 4px 0 0 0;">${collaboration}</p>
              </td>
            </tr>
            ` : ''}
          </table>
        </div>

        <!-- Besoins & Intérêts -->
        <div style="background-color: #18181B; border-radius: 12px; padding: 24px; margin: 32px 0; border: 1px solid #27272A;">
          <h3 style="color: #FAFAFA; font-size: 16px; margin: 0 0 16px 0; border-bottom: 1px solid #27272A; padding-bottom: 12px;">🎯 Besoins & Intérêts</h3>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${biggestProblem ? `
            <tr>
              <td style="padding: 12px 0;">
                <span style="color: #71717A; font-size: 12px; text-transform: uppercase; font-weight: 600;">Problème Principal</span>
                <p style="color: #FAFAFA; font-size: 14px; margin: 4px 0 0 0;">${biggestProblem}</p>
              </td>
            </tr>
            ` : ''}
            ${interests && interests.length > 0 ? `
            <tr ${biggestProblem ? 'style="border-top: 1px solid #27272A;"' : ''}>
              <td style="padding: 12px 0;">
                <span style="color: #71717A; font-size: 12px; text-transform: uppercase; font-weight: 600;">Intérêts</span>
                <p style="color: #FAFAFA; font-size: 14px; margin: 4px 0 0 0;">${interests.join(', ')}</p>
              </td>
            </tr>
            ` : ''}
            ${marketplaceInterest ? `
            <tr ${biggestProblem || (interests && interests.length > 0) ? 'style="border-top: 1px solid #27272A;"' : ''}>
              <td style="padding: 12px 0;">
                <span style="color: #71717A; font-size: 12px; text-transform: uppercase; font-weight: 600;">Intérêt Marketplace</span>
                <p style="color: #FAFAFA; font-size: 14px; margin: 4px 0 0 0;">${marketplaceInterest}</p>
              </td>
            </tr>
            ` : ''}
          </table>
        </div>

        <!-- Infos Additionnelles -->
        <div style="background-color: #18181B; border-radius: 12px; padding: 24px; margin: 32px 0; border: 1px solid #27272A;">
          <h3 style="color: #FAFAFA; font-size: 16px; margin: 0 0 16px 0; border-bottom: 1px solid #27272A; padding-bottom: 12px;">ℹ️ Informations Additionnelles</h3>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${feedbackReady ? `
            <tr>
              <td style="padding: 12px 0;">
                <span style="color: #71717A; font-size: 12px; text-transform: uppercase; font-weight: 600;">Retour Prêt</span>
                <p style="color: #FAFAFA; font-size: 14px; margin: 4px 0 0 0;">${feedbackReady}</p>
              </td>
            </tr>
            ` : ''}
            ${link ? `
            <tr ${feedbackReady ? 'style="border-top: 1px solid #27272A;"' : ''}>
              <td style="padding: 12px 0;">
                <span style="color: #71717A; font-size: 12px; text-transform: uppercase; font-weight: 600;">Lien Portfolio</span>
                <p style="color: #E91E63; font-size: 12px; margin: 4px 0 0 0; word-break: break-all;"><a href="${link}" style="color: #E91E63; text-decoration: none;">${link}</a></p>
              </td>
            </tr>
            ` : ''}
            ${source ? `
            <tr ${feedbackReady || link ? 'style="border-top: 1px solid #27272A;"' : ''}>
              <td style="padding: 12px 0;">
                <span style="color: #71717A; font-size: 12px; text-transform: uppercase; font-weight: 600;">Source</span>
                <p style="color: #FAFAFA; font-size: 14px; margin: 4px 0 0 0;">${source}</p>
              </td>
            </tr>
            ` : ''}
          </table>
        </div>

        <!-- Button -->
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding: 32px 0;">
              <a href="${baseAdminUrl}" style="display: inline-block; background: linear-gradient(135deg, #E91E63 0%, #C2185B 100%); color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                Gérer les Inscriptions
              </a>
            </td>
          </tr>
        </table>

        <p style="color: #71717A; font-size: 12px; line-height: 1.6; margin: 32px 0 0 0; text-align: center;">
          Cette inscription a été reçue à ${new Date().toLocaleString('fr-FR')}
        </p>
      `, 'Nouvelle Inscription Bêta', '✨'),
      text: `
NOUVELLE INSCRIPTION BÊTA #${signupNum}

Une nouvelle personne s'est inscrite à la bêta de Toftal Clip.

=== INFORMATIONS PERSONNELLES ===
Nom: ${name}
Contact: ${contact}
Email: ${email}

=== DÉTAILS PROFESSIONNELS ===
${role ? `Rôle: ${role}` : ''}
${videoCount ? `Vidéos/Mois: ${videoCount}` : ''}
${collaboration ? `Collaboration: ${collaboration}` : ''}

=== BESOINS & INTÉRÊTS ===
${biggestProblem ? `Problème Principal: ${biggestProblem}` : ''}
${interests && interests.length > 0 ? `Intérêts: ${interests.join(', ')}` : ''}
${marketplaceInterest ? `Intérêt Marketplace: ${marketplaceInterest}` : ''}

=== INFORMATIONS ADDITIONNELLES ===
${feedbackReady ? `Retour Prêt: ${feedbackReady}` : ''}
${link ? `Lien Portfolio: ${link}` : ''}
${source ? `Source: ${source}` : ''}

Allez à l'administration: ${baseAdminUrl}

- L'équipe Toftal Clip
      `,
    };
  },

  // Beta signup confirmation - sent to the user who signed up
  betaSignupConfirmation: (name: string) => ({
    subject: '🎉 Bienvenue chez Toftal Clip ! Votre inscription a été confirmée',
    html: emailWrapper(`
      <h2 style="color: #FAFAFA; margin: 0 0 16px 0; font-size: 24px;">Bienvenue ${name} ! 🎉</h2>
      <p style="color: #A1A1AA; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
        Merci de vous être inscrit à la liste d'attente de Toftal Clip. Nous sommes ravi de vous compter parmi nos premiers utilisateurs.
      </p>

      <div style="background: linear-gradient(135deg, #E91E63 0%, #C2185B 100%); border-radius: 12px; padding: 24px; margin: 32px 0; text-align: center;">
        <h3 style="color: white; margin: 0 0 12px 0; font-size: 20px;">Prochaines étapes</h3>
        <p style="color: white; font-size: 14px; margin: 0; line-height: 1.6;">
          Notre équipe examinera votre inscription et vous contactera très bientôt pour vous donner accès à la plateforme.
        </p>
      </div>

      <div style="background-color: #18181B; border-radius: 12px; padding: 24px; margin: 32px 0; border: 1px solid #27272A;">
        <h3 style="color: #FAFAFA; font-size: 16px; margin: 0 0 16px 0; border-bottom: 1px solid #27272A; padding-bottom: 12px;">✨ À propos de Toftal Clip</h3>
        <p style="color: #A1A1AA; font-size: 14px; line-height: 1.6; margin: 0 0 12px 0;">
          Toftal Clip est la plateforme d'élite pour connecter les créateurs, entrepreneurs et influenceurs aux meilleurs monteurs vidéo pour une croissance explosive de votre contenu.
        </p>
        <ul style="color: #A1A1AA; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
          <li>🎥 Accès à un talent pool curé de monteurs expérimentés</li>
          <li>💬 Collaboration centralisée et feedback en temps réel</li>
          <li>🤖 Assistance IA pour optimiser vos briefs et vos projets</li>
          <li>📊 Suivi détaillé et analytics de vos productions</li>
        </ul>
      </div>

      <div style="background-color: #18181B; border-radius: 12px; padding: 24px; margin: 32px 0; border: 1px solid #27272A;">
        <h3 style="color: #FAFAFA; font-size: 16px; margin: 0 0 16px 0; border-bottom: 1px solid #27272A; padding-bottom: 12px;">❓ Des questions ?</h3>
        <p style="color: #A1A1AA; font-size: 14px; line-height: 1.6; margin: 0;">
          N'hésitez pas à nous contacter à <a href="mailto:support@toftalclip.com" style="color: #E91E63; text-decoration: none;">support@toftalclip.com</a> ou à nous répondre directement à cet email.
        </p>
      </div>

      <p style="color: #71717A; font-size: 12px; line-height: 1.6; margin: 32px 0 0 0; text-align: center;">
        À bientôt sur Toftal Clip !<br>
        L'équipe Toftal Clip
      </p>
    `, 'Bienvenue chez Toftal Clip', '✨'),
    text: `
BIENVENUE CHEZ TOFTAL CLIP ! 🎉

Merci de vous être inscrit à la liste d'attente de Toftal Clip.

Notre équipe examinera votre inscription et vous contactera très bientôt pour vous donner accès à la plateforme.

À PROPOS DE TOFTAL CLIP
- Accès à un talent pool curé de monteurs expérimentés
- Collaboration centralisée et feedback en temps réel
- Assistance IA pour optimiser vos briefs et vos projets
- Suivi détaillé et analytics de vos productions

Des questions ?
N'hésitez pas à nous contacter à support@toftalclip.com ou à nous répondre directement à cet email.

À bientôt sur Toftal Clip !
L'équipe Toftal Clip
    `,
  }),

  // Collaborator added - sent to collaborator when added to a project
  collaboratorAdded: (collaboratorName: string, projectTitle: string, addedBy: string, projectId: string, permissions?: { view?: boolean; edit?: boolean; comment?: boolean; approve?: boolean }) => {
    // Default permissions if not provided
    const perms = permissions || { view: true, edit: true, comment: true, approve: false };

    // Build permissions list dynamically
    const permissionsList = [
      perms.view && '<li>✅ Voir tous les livrables du projet</li>',
      perms.edit && '<li>✏️ Modifier et éditer les contenus</li>',
      perms.comment && '<li>💬 Laisser des commentaires et feedbacks</li>',
      perms.approve && '<li>✔️ Approuver les livrables</li>',
    ].filter(Boolean).join('');

    const permissionsText = [
      perms.view && '- Voir tous les livrables du projet',
      perms.edit && '- Modifier et éditer les contenus',
      perms.comment && '- Laisser des commentaires et feedbacks',
      perms.approve && '- Approuver les livrables',
    ].filter(Boolean).join('\n');

    return {
    subject: `Vous avez été ajouté au projet "${projectTitle}"`,
    html: emailWrapper(`
      <h2 style="color: #FAFAFA; margin: 0 0 16px 0; font-size: 24px;">Bonjour ${collaboratorName} ! 👋</h2>
      <p style="color: #A1A1AA; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
        <strong style="color: #E91E63;">${addedBy}</strong> vous a ajouté comme collaborateur sur le projet <strong style="color: #FAFAFA;">${projectTitle}</strong>.
      </p>

      <div style="background-color: #18181B; border-radius: 12px; padding: 24px; margin: 24px 0; border-left: 4px solid #E91E63;">
        <h3 style="color: #FAFAFA; font-size: 18px; margin: 0 0 12px 0;">🎯 Vos permissions</h3>
        <p style="color: #A1A1AA; font-size: 14px; line-height: 1.6; margin: 0;">
          En tant que <strong style="color: #FAFAFA;">collaborateur</strong>, vous pouvez:
        </p>
        <ul style="color: #A1A1AA; font-size: 14px; line-height: 1.8; margin: 12px 0 0 0; padding-left: 20px;">
          ${permissionsList}
          <li>🔔 Recevoir les notifications en temps réel</li>
        </ul>
      </div>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/#/workspace/${projectId}"
           style="display: inline-block; background: linear-gradient(135deg, #E91E63 0%, #C2185B 100%);
                  color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px;
                  font-weight: bold; font-size: 16px; box-shadow: 0 4px 12px rgba(233, 30, 99, 0.3);">
          📂 Accéder au projet
        </a>
      </div>

      <div style="background-color: #18181B; border-radius: 12px; padding: 20px; margin: 24px 0; border: 1px solid #27272A;">
        <p style="color: #71717A; font-size: 13px; line-height: 1.6; margin: 0;">
          💡 <strong style="color: #A1A1AA;">Astuce:</strong> Vous recevrez des notifications pour tous les événements importants du projet (nouveaux livrables, commentaires, versions, etc.).
        </p>
      </div>

      <p style="color: #A1A1AA; font-size: 14px; line-height: 1.6; margin: 24px 0 0 0;">
        Bonne collaboration ! 🚀<br>
        <span style="color: #71717A;">L'équipe Toftal Clip</span>
      </p>
    `, 'Nouveau collaborateur', '🤝'),
    text: `
Bonjour ${collaboratorName} !

${addedBy} vous a ajouté comme collaborateur sur le projet "${projectTitle}".

VOS PERMISSIONS
En tant que collaborateur, vous pouvez:
${permissionsText}
- Recevoir les notifications en temps réel

Accéder au projet: ${config.frontendUrl}/workspace/${projectId}

Astuce: Vous recevrez des notifications pour tous les événements importants du projet.

Bonne collaboration !
L'équipe Toftal Clip
    `,
  };
  },

  // Member role updated - sent to member when their role changes
  memberRoleUpdated: (
    memberName: string,
    projectTitle: string,
    projectId: string,
    oldRole: string,
    newRole: string,
    updatedBy: string
  ) => {
    const getRoleLabel = (role: string) => {
      switch (role) {
        case 'OWNER': return 'Propriétaire';
        case 'COLLABORATOR': return 'Éditeur';
        case 'VIEWER': return 'Lecteur';
        default: return role;
      }
    };

    return {
      subject: `Votre rôle a changé - ${projectTitle}`,
      html: emailWrapper(`
      <h2 style="color: #FAFAFA; margin: 0 0 16px 0; font-size: 24px;">Bonjour ${memberName} !</h2>

      <p style="color: #A1A1AA; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
        ${updatedBy} a modifié votre rôle sur le projet <strong style="color: #FAFAFA;">"${projectTitle}"</strong>.
      </p>

      <!-- Role Change Box -->
      <div style="background: linear-gradient(135deg, rgba(233, 30, 99, 0.1) 0%, rgba(194, 24, 91, 0.05) 100%); border: 1px solid rgba(233, 30, 99, 0.2); border-radius: 12px; padding: 24px; margin: 24px 0;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="background: rgba(113, 113, 122, 0.2); padding: 12px 16px; border-radius: 8px; flex: 1; text-align: center;">
            <span style="color: #71717A; font-size: 12px; text-transform: uppercase; font-weight: 600;">Ancien rôle</span>
            <p style="color: #FAFAFA; font-size: 16px; font-weight: 600; margin: 4px 0 0 0;">${getRoleLabel(oldRole)}</p>
          </div>
          <div style="color: #E91E63; font-size: 24px;">→</div>
          <div style="background: rgba(233, 30, 99, 0.2); padding: 12px 16px; border-radius: 8px; flex: 1; text-align: center; border: 1px solid rgba(233, 30, 99, 0.3);">
            <span style="color: #E91E63; font-size: 12px; text-transform: uppercase; font-weight: 600;">Nouveau rôle</span>
            <p style="color: #FAFAFA; font-size: 16px; font-weight: 600; margin: 4px 0 0 0;">${getRoleLabel(newRole)}</p>
          </div>
        </div>
      </div>

      <p style="color: #A1A1AA; font-size: 14px; line-height: 1.6; margin: 24px 0;">
        Vos nouvelles permissions sont maintenant actives.
      </p>

      <!-- Button -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="padding: 24px 0;">
            <a href="${config.frontendUrl}/#/workspace/${projectId}" style="display: inline-block; background: linear-gradient(135deg, #E91E63 0%, #C2185B 100%); color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Accéder au Projet
            </a>
          </td>
        </tr>
      </table>

      <p style="color: #A1A1AA; font-size: 14px; line-height: 1.6; margin: 24px 0 0 0;">
        Bonne collaboration ! 🚀<br>
        <span style="color: #71717A;">L'équipe Toftal Clip</span>
      </p>
    `, 'Rôle modifié', '🔄'),
      text: `
Bonjour ${memberName} !

${updatedBy} a modifié votre rôle sur le projet "${projectTitle}".

CHANGEMENT DE RÔLE
Ancien rôle: ${getRoleLabel(oldRole)}
Nouveau rôle: ${getRoleLabel(newRole)}

Vos nouvelles permissions sont maintenant actives.

Accéder au projet: ${config.frontendUrl}/#/workspace/${projectId}

Bonne collaboration !
L'équipe Toftal Clip
      `,
    };
  },
};

// Send email function
export const sendEmail = async (to: string, template: { subject: string; html: string; text: string }) => {
  const mailOptions = {
    from: process.env.EMAIL_FROM || '"Toftal Clip" <noreply@toftalclip.com>',
    to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✉️ Email sent:', info.messageId);

    // For Ethereal, log the preview URL
    if (info.messageId && process.env.NODE_ENV !== 'production') {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) {
        console.log('📧 Preview URL:', previewUrl);
      }
    }

    return info;
  } catch (error) {
    console.error('Failed to send email:', error);
    throw error;
  }
};
