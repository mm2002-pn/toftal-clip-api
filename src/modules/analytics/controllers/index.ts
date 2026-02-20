import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';

export const getDashboardStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id;

    const [totalProjects, activeProjects, completedProjects, inReviewProjects] = await Promise.all([
      prisma.project.count({ where: { OR: [{ clientId: userId }, { talentId: userId }] } }),
      prisma.project.count({ where: { OR: [{ clientId: userId }, { talentId: userId }], status: 'IN_PROGRESS' } }),
      prisma.project.count({ where: { OR: [{ clientId: userId }, { talentId: userId }], status: 'COMPLETED' } }),
      prisma.project.count({ where: { OR: [{ clientId: userId }, { talentId: userId }], status: 'REVIEW' } }),
    ]);

    ApiResponse.success(res, {
      totalProjects,
      activeProjects,
      completedProjects,
      inReviewProjects,
    });
  } catch (error) {
    next(error);
  }
};

export const getProjectStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id;

    const projectsByStatus = await prisma.project.groupBy({
      by: ['status'],
      where: { OR: [{ clientId: userId }, { talentId: userId }] },
      _count: true,
    });

    const recentProjects = await prisma.project.findMany({
      where: { OR: [{ clientId: userId }, { talentId: userId }] },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, title: true, status: true, createdAt: true },
    });

    ApiResponse.success(res, { projectsByStatus, recentProjects });
  } catch (error) {
    next(error);
  }
};

export const getTalentStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    const profile = await prisma.talentProfile.findUnique({
      where: { id },
    });

    if (!profile) {
      ApiResponse.success(res, null);
      return;
    }

    const [portfolioCount, reviewsCount, packagesCount, completedProjects] = await Promise.all([
      prisma.portfolioItem.count({ where: { talentId: id } }),
      prisma.review.count({ where: { talentId: id } }),
      prisma.package.count({ where: { talentId: id } }),
      prisma.project.count({ where: { talentId: profile.userId, status: 'COMPLETED' } }),
    ]);

    ApiResponse.success(res, {
      rating: profile.rating,
      reviewsCount: profile.reviewsCount,
      completedProjects,
      portfolioCount,
      packagesCount,
    });
  } catch (error) {
    next(error);
  }
};
