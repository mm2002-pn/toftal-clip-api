import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth';
import * as organizationsController from '../controllers';

const router = Router();

// Public: anyone with the token can preview the invitation metadata.
router.get('/invitations/verify/:token', organizationsController.verifyTeamInvitationToken);

// Public: refusing an invitation doesn't require an account — the invitee
// might decline before signing up.
router.post('/invitations/refuse', organizationsController.refuseTeamInvitation);

// Everything below requires an authenticated user.
router.use(authenticate);

router.post('/invitations/accept', organizationsController.acceptTeamInvitation);

router.post('/', organizationsController.createOrganization);
router.get('/me', organizationsController.getMyOrganizations);
router.post('/:orgId/invitations', organizationsController.sendTeamInvitations);
router.post('/:orgId/invitations/:invitationId/resend', organizationsController.resendTeamInvitation);
router.delete('/:orgId/members/:memberId', organizationsController.removeOrganizationMember);
router.post('/:orgId/notify-admin', organizationsController.notifyTeamAdmin);
router.patch('/:orgId/members/me/job-label', organizationsController.updateMyJobLabel);

export default router;
