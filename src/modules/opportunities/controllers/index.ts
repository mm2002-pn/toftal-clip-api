import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { ForbiddenError, NotFoundError } from '../../../utils/errors';

export const createOpportunity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { title, type, volume, duration, style, deadline, level, description, isRecurring, whatsappNumber } = req.body;

    // Get user info for client name
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });

    // Normalize level (convert "Confirmé" to "Confirme" for Prisma enum)
    const normalizedLevel = level === 'Confirmé' ? 'Confirme' : level;

    const opportunity = await prisma.opportunity.create({
      data: {
        title,
        clientId: req.user!.id,
        clientName: user?.name || req.user!.email,
        clientAvatar: user?.avatarUrl,
        type,
        volume,
        duration,
        style,
        deadline,
        level: normalizedLevel,
        description,
        isRecurring,
        whatsappNumber,
      },
    });

    ApiResponse.created(res, opportunity, 'Opportunity created');
  } catch (error) {
    next(error);
  }
};

export const updateOpportunity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const data = { ...req.body };

    // Normalize level if present
    if (data.level === 'Confirmé') {
      data.level = 'Confirme';
    }

    const opportunity = await prisma.opportunity.update({
      where: { id },
      data,
    });

    ApiResponse.success(res, opportunity, 'Opportunity updated');
  } catch (error) {
    next(error);
  }
};

export const deleteOpportunity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    await prisma.opportunity.delete({ where: { id } });
    ApiResponse.success(res, null, 'Opportunity deleted');
  } catch (error) {
    next(error);
  }
};

export const applyToOpportunity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { message } = req.body;

    // Check if already applied
    const existingApplication = await prisma.application.findFirst({
      where: { opportunityId: id, talentId: req.user!.id },
    });

    if (existingApplication) {
      return ApiResponse.badRequest(res, 'You have already applied to this opportunity') as any;
    }

    const application = await prisma.application.create({
      data: {
        opportunityId: id,
        talentId: req.user!.id,
        message,
      },
    });

    ApiResponse.created(res, application, 'Application submitted');
  } catch (error) {
    next(error);
  }
};

// Get applications for an opportunity (Client only)
export const getOpportunityApplications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    // Check ownership
    const opportunity = await prisma.opportunity.findUnique({ where: { id } });
    if (!opportunity) {
      throw new NotFoundError('Opportunity not found');
    }
    if (opportunity.clientId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new ForbiddenError('You can only view applications for your own opportunities');
    }

    const applications = await prisma.application.findMany({
      where: { opportunityId: id },
      include: {
        opportunity: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get talent profiles for each application
    const applicationsWithTalents = await Promise.all(
      applications.map(async (app) => {
        const talent = await prisma.user.findUnique({
          where: { id: app.talentId },
          select: { id: true, name: true, email: true, avatarUrl: true },
        });
        const talentProfile = await prisma.talentProfile.findUnique({
          where: { userId: app.talentId },
          select: { skills: true, rating: true, completedProjects: true },
        });
        return { ...app, talent, talentProfile };
      })
    );

    ApiResponse.success(res, applicationsWithTalents);
  } catch (error) {
    next(error);
  }
};

// Update application status (Client only)
export const updateApplicationStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const applicationId = String(req.params.applicationId);
    const { status } = req.body;

    // Check ownership
    const opportunity = await prisma.opportunity.findUnique({ where: { id } });
    if (!opportunity) {
      throw new NotFoundError('Opportunity not found');
    }
    if (opportunity.clientId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new ForbiddenError('You can only manage applications for your own opportunities');
    }

    const application = await prisma.application.update({
      where: { id: applicationId },
      data: { status },
    });

    ApiResponse.success(res, application, `Application ${status.toLowerCase()}`);
  } catch (error) {
    next(error);
  }
};

// Get my applications (Talent)
export const getMyApplications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const applications = await prisma.application.findMany({
      where: { talentId: req.user!.id },
      include: {
        opportunity: {
          include: { client: { select: { id: true, name: true, avatarUrl: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    ApiResponse.success(res, applications);
  } catch (error) {
    next(error);
  }
};

// Withdraw application (Talent)
export const withdrawApplication = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const applicationId = String(req.params.applicationId);

    const application = await prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) {
      throw new NotFoundError('Application not found');
    }
    if (application.talentId !== req.user!.id) {
      throw new ForbiddenError('You can only withdraw your own applications');
    }

    await prisma.application.delete({ where: { id: applicationId } });

    ApiResponse.success(res, null, 'Application withdrawn');
  } catch (error) {
    next(error);
  }
};
