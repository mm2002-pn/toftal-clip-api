/**
 * Seed the DB with every email template currently hardcoded in
 * `src/config/email.ts`. The strategy: call each existing template function
 * with `{{variable}}` placeholders as arguments — the wrapping HTML is
 * preserved, and runtime interpolation simply replaces those placeholders.
 *
 * This keeps the seed tiny (no HTML duplication) and means any later tweak
 * to the `emailWrapper` or shared markup in email.ts automatically flows
 * into future seeds on reset.
 *
 * Idempotent. Use `--reset` to overwrite existing templates.
 *
 * Usage:
 *   npm run seed:email-templates
 *   npm run seed:email-templates -- --reset
 */

import { PrismaClient } from '@prisma/client';
import { emailTemplates } from '../src/config/email';

const prisma = new PrismaClient();
const resetMode = process.argv.includes('--reset');

interface TemplateDef {
  name: string;
  description: string;
  variables: string[];
  build: () => { subject: string; html: string; text?: string };
}

// Every variable becomes `{{varName}}` inside the template — runtime
// interpolation replaces them with actual values on send.
const v = (name: string) => `{{${name}}}`;

const DEFS: TemplateDef[] = [
  {
    name: 'invitation',
    description: "Invitation à collaborer sur un projet",
    variables: ['email', 'projectTitle', 'inviterName', 'invitationUrl', 'message'],
    build: () => emailTemplates.projectInvitation(v('email'), v('projectTitle'), v('inviterName'), v('invitationUrl'), v('message')),
  },
  {
    name: 'verify_email',
    description: "Vérification de l'adresse email à l'inscription",
    variables: ['name', 'verificationUrl'],
    build: () => emailTemplates.verification(v('name'), v('verificationUrl')),
  },
  {
    name: 'password_reset_otp',
    description: 'OTP pour réinitialiser le mot de passe',
    variables: ['name', 'otp'],
    build: () => emailTemplates.forgotPassword(v('name'), v('otp')),
  },
  {
    name: 'talent_assigned',
    description: 'Notification talent : assigné à un livrable',
    variables: ['talentName', 'deliverableTitle', 'projectTitle', 'workspaceUrl'],
    build: () => emailTemplates.talentAssigned(v('talentName'), v('deliverableTitle'), v('projectTitle'), v('workspaceUrl')),
  },
  {
    name: 'talent_unassigned',
    description: 'Notification talent : désassigné d\'un livrable',
    variables: ['talentName', 'deliverableTitle', 'projectTitle', 'workspaceUrl'],
    build: () => emailTemplates.talentUnassigned(v('talentName'), v('deliverableTitle'), v('projectTitle'), v('workspaceUrl')),
  },
  {
    name: 'new_version',
    description: 'Notification client : nouvelle version uploadée',
    variables: ['clientName', 'deliverableTitle', 'projectTitle', 'versionNumber', 'workspaceUrl'],
    build: () => emailTemplates.newVersion(v('clientName'), v('deliverableTitle'), v('projectTitle'), Number(v('versionNumber')) || 0, v('workspaceUrl')),
  },
  {
    name: 'assignment_accepted',
    description: 'Notification client : talent a accepté',
    variables: ['clientName', 'talentName', 'deliverableTitle', 'projectTitle', 'workspaceUrl'],
    build: () => emailTemplates.assignmentAccepted(v('clientName'), v('talentName'), v('deliverableTitle'), v('projectTitle'), v('workspaceUrl')),
  },
  {
    name: 'assignment_rejected',
    description: 'Notification client : talent a refusé',
    variables: ['clientName', 'talentName', 'deliverableTitle', 'projectTitle', 'reason', 'workspaceUrl'],
    build: () => emailTemplates.assignmentRejected(v('clientName'), v('talentName'), v('deliverableTitle'), v('projectTitle'), v('reason'), v('workspaceUrl')),
  },
  {
    name: 'access_request',
    description: "Demande d'accès à un projet par un user",
    variables: ['requesterName', 'requesterEmail', 'projectTitle', 'message', 'projectUrl'],
    build: () => emailTemplates.accessRequest(v('requesterName'), v('requesterEmail'), v('projectTitle'), v('message'), v('projectUrl')),
  },
  {
    name: 'access_approved',
    description: "Demande d'accès approuvée",
    variables: ['projectTitle'],
    build: () => emailTemplates.accessApproved(v('projectTitle')),
  },
  {
    name: 'access_rejected',
    description: "Demande d'accès refusée",
    variables: ['projectTitle'],
    build: () => emailTemplates.accessRejected(v('projectTitle')),
  },
  {
    name: 'invitation_accepted',
    description: 'Notification client : talent a accepté une invitation projet',
    variables: ['talentName', 'clientName', 'projectTitle', 'workspaceUrl'],
    build: () => emailTemplates.invitationAccepted(v('talentName'), v('clientName'), v('projectTitle'), v('workspaceUrl')),
  },
  {
    name: 'invitation_rejected',
    description: 'Notification client : talent a refusé une invitation projet',
    variables: ['talentName', 'clientEmail', 'projectTitle', 'workspaceUrl', 'reason'],
    build: () => emailTemplates.invitationRejected(v('talentName'), v('clientEmail'), v('projectTitle'), v('workspaceUrl'), v('reason')),
  },
  {
    name: 'beta_signup_notification',
    description: 'Notification admin : nouveau beta signup',
    variables: ['name', 'email', 'contact', 'role', 'interests', 'videoCount', 'collaboration', 'biggestProblem', 'feedbackReady', 'link', 'marketplaceInterest', 'source'],
    build: () =>
      emailTemplates.betaSignupNotification(
        v('name'),
        v('email'),
        v('contact'),
        v('role'),
        [v('interests')],
        v('videoCount'),
        v('collaboration'),
        v('biggestProblem'),
        v('feedbackReady'),
        v('link'),
        v('marketplaceInterest'),
        v('source')
      ),
  },
  {
    name: 'beta_signup_confirmation',
    description: 'Confirmation beta signup envoyée au user',
    variables: ['name'],
    build: () => emailTemplates.betaSignupConfirmation(v('name')),
  },
  {
    name: 'collaborator_added',
    description: 'Ajout d\'un collaborateur à un projet',
    variables: ['collaboratorName', 'projectTitle', 'addedBy', 'projectId'],
    build: () => emailTemplates.collaboratorAdded(v('collaboratorName'), v('projectTitle'), v('addedBy'), v('projectId')),
  },
  {
    name: 'member_role_updated',
    description: 'Mise à jour du rôle d\'un membre',
    variables: ['memberName', 'projectTitle', 'updatedBy', 'projectId', 'oldRole', 'newRole'],
    build: () => emailTemplates.memberRoleUpdated(v('memberName'), v('projectTitle'), v('updatedBy'), v('projectId'), v('oldRole'), v('newRole')),
  },
  {
    name: 'video_share_invitation',
    description: 'Partage d\'une vidéo via lien',
    variables: ['recipientName', 'senderName', 'projectTitle', 'deliverableTitle', 'shareUrl', 'message'],
    build: () => emailTemplates.videoShareInvitation(v('recipientName'), v('senderName'), v('projectTitle'), v('deliverableTitle'), v('shareUrl'), v('message')),
  },
  {
    name: 'ownership_transfer_request',
    description: 'Demande de transfert de propriété d\'un projet',
    variables: ['recipientName', 'senderName', 'projectTitle', 'acceptUrl', 'expiresAt'],
    // expiresAt is a Date in the hardcoded template (calls .toLocaleDateString).
    // We pass a fixed date at seed time and replace it in the rendered HTML with
    // a {{expiresAt}} placeholder.
    build: () => {
      const out = emailTemplates.ownershipTransferRequest(
        v('recipientName'),
        v('senderName'),
        v('projectTitle'),
        v('acceptUrl'),
        new Date('2099-12-31T23:59:59.000Z')
      );
      const expiryLocal = new Date('2099-12-31T23:59:59.000Z').toLocaleDateString('fr-FR');
      return {
        subject: out.subject.replace(expiryLocal, v('expiresAt')),
        html: out.html.split(expiryLocal).join(v('expiresAt')),
        text: out.text.split(expiryLocal).join(v('expiresAt')),
      };
    },
  },
  {
    name: 'ownership_transfer_accepted',
    description: 'Transfert de propriété accepté',
    variables: ['fromName', 'toName', 'projectTitle', 'projectUrl'],
    build: () => emailTemplates.ownershipTransferAccepted(v('fromName'), v('toName'), v('projectTitle'), v('projectUrl')),
  },
  {
    name: 'ownership_transfer_rejected',
    description: 'Transfert de propriété refusé',
    variables: ['fromName', 'toName', 'projectTitle', 'reason'],
    build: () => emailTemplates.ownershipTransferRejected(v('fromName'), v('toName'), v('projectTitle'), v('reason')),
  },
];

async function main() {
  console.log(`📧 Seeding ${DEFS.length} email templates (reset=${resetMode})…`);

  let created = 0;
  let reset = 0;
  let skipped = 0;
  let failed = 0;

  for (const def of DEFS) {
    try {
      const existing = await prisma.emailTemplate.findUnique({ where: { name: def.name } });

      if (existing && !resetMode) {
        skipped++;
        continue;
      }

      const built = def.build();
      const data = {
        name: def.name,
        description: def.description,
        subject: built.subject,
        htmlBody: built.html,
        textBody: built.text ?? null,
        variables: def.variables,
      };

      if (existing) {
        await prisma.emailTemplate.update({ where: { name: def.name }, data });
        console.log(`   ↺ reset ${def.name}`);
        reset++;
      } else {
        await prisma.emailTemplate.create({ data });
        console.log(`   + created ${def.name}`);
        created++;
      }
    } catch (err) {
      console.warn(`   ! failed ${def.name}: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\n✅ Done — created=${created} reset=${reset} skipped=${skipped} failed=${failed}`);
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
