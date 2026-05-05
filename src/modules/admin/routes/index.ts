import { Router } from 'express';
import { authenticate, authorize } from '../../../middlewares/auth';
import * as usersController from '../controllers/users';
import * as projectsController from '../controllers/projects';
import * as deliverablesController from '../controllers/deliverables';
import * as versionsController from '../controllers/versions';
import * as featureFlagsController from '../controllers/featureFlags';
import * as invitationsController from '../controllers/invitations';
import * as storageController from '../controllers/storage';
import * as membersController from '../controllers/members';
import * as emailTemplatesController from '../controllers/emailTemplates';
import * as aiPromptsController from '../controllers/aiPrompts';
import * as plansController from '../controllers/plans';

const router = Router();

// All admin routes require authentication + ADMIN role.
// Listing (users/projects/audit/stats) is handled via GraphQL — this router
// only exposes write/action endpoints.
router.use(authenticate);
router.use(authorize('ADMIN'));

// Users — actions
router.patch('/users/:id/role', usersController.setUserRole);
router.patch('/users/:id/suspend', usersController.setUserSuspended);
router.patch('/users/:id/restore', usersController.restoreUser);
router.delete('/users/:id', usersController.deleteUser);

// Projects — actions
router.patch('/projects/:id/status', projectsController.setProjectStatus);
router.post('/projects/:id/transfer', projectsController.transferProject);
router.patch('/projects/:id/archive', projectsController.setProjectArchived);
router.delete('/projects/:id', projectsController.deleteProject);

// Project members — actions
router.post('/projects/:id/members', membersController.addMember);
router.patch('/projects/:id/members/:memberId', membersController.updateMember);
router.delete('/projects/:id/members/:memberId', membersController.removeMember);

// Deliverables — actions
router.patch('/deliverables/:id/status', deliverablesController.setDeliverableStatus);
router.delete('/deliverables/:id', deliverablesController.deleteDeliverable);

// Versions — actions
router.patch('/versions/:id/status', versionsController.setVersionStatus);
router.delete('/versions/:id', versionsController.deleteVersion);

// Feature flags
router.post('/feature-flags', featureFlagsController.createFeatureFlag);
router.patch('/feature-flags/:id', featureFlagsController.updateFeatureFlag);
router.delete('/feature-flags/:id', featureFlagsController.deleteFeatureFlag);

// Invitations — actions
router.post('/invitations/:id/revoke', invitationsController.revokeInvitation);

// Storage — purge jobs
router.post('/storage/purge-old-versions', storageController.purgeOldVersions);
router.post('/storage/purge-deleted-projects', storageController.purgeDeletedProjects);

// Email templates — edit + preview
router.patch('/email-templates/:id', emailTemplatesController.updateEmailTemplate);
router.post('/email-templates/:id/preview', emailTemplatesController.previewEmailTemplate);

// AI prompt templates — edit
router.patch('/ai-prompts/:id', aiPromptsController.updateAIPrompt);

// Subscription plans — full CRUD (list incl. inactive + create/update/delete)
router.get('/plans', plansController.listAdminPlans);
router.post('/plans', plansController.createAdminPlan);
router.patch('/plans/:id', plansController.updateAdminPlan);
router.delete('/plans/:id', plansController.deleteAdminPlan);

export default router;
