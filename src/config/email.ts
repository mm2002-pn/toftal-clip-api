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
