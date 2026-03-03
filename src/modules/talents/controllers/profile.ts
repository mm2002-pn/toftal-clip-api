import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { NotFoundError, ForbiddenError, BadRequestError } from '../../../utils/errors';

// Update talent profile (tagline, bio, social links, stats, expertise, skills)
export const updateTalentProfile = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const idString = Array.isArray(id) ? id[0] : id;
    const {
      tagline,
      bio,
      location,
      languages,
      skills,
      expertise,
      videoType,
      responseTime,
      startingPrice,
      coverImage,
      socialLinks,
      stats
    } = req.body;

    // Verify talent profile exists
    const talentProfile = await prisma.talentProfile.findUnique({
      where: { id: idString },
      include: { user: true }
    });

    if (!talentProfile) {
      throw new NotFoundError('Profil talent non trouvé');
    }

    // Check authorization - only owner or admin
    if (talentProfile.userId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new ForbiddenError('Vous n\'avez pas la permission de modifier ce profil');
    }

    // Validate social links structure if provided
    if (socialLinks) {
      const validKeys = ['youtube', 'vimeo', 'instagram', 'tiktok', 'website', 'linkedin', 'behance', 'dribbble'];
      const providedKeys = Object.keys(socialLinks);
      const invalidKeys = providedKeys.filter(key => !validKeys.includes(key));

      if (invalidKeys.length > 0) {
        throw new BadRequestError(`Clés invalides dans socialLinks: ${invalidKeys.join(', ')}`);
      }
    }

    // Validate stats structure if provided
    if (stats) {
      const validKeys = ['totalViews', 'yearsExperience', 'clientsServed'];
      const providedKeys = Object.keys(stats);
      const invalidKeys = providedKeys.filter(key => !validKeys.includes(key));

      if (invalidKeys.length > 0) {
        throw new BadRequestError(`Clés invalides dans stats: ${invalidKeys.join(', ')}`);
      }
    }

    // Update profile
    const updatedProfile = await prisma.talentProfile.update({
      where: { id: idString },
      data: {
        tagline,
        bio,
        location,
        languages,
        skills,
        expertise,
        videoType,
        responseTime,
        startingPrice,
        coverImage,
        socialLinks: socialLinks || undefined,
        stats: stats || undefined,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true
          }
        },
        portfolio: {
          orderBy: { orderIndex: 'asc' }
        },
        packages: true,
        reviews: {
          include: {
            author: {
              select: { id: true, name: true, avatarUrl: true }
            }
          }
        }
      }
    });

    ApiResponse.success(res, updatedProfile, 'Profil mis à jour avec succès');
  } catch (error) {
    next(error);
  }
};

// Get talent profile by ID (public)
export const getTalentProfile = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const idString = Array.isArray(id) ? id[0] : id;

    const talentProfile = await prisma.talentProfile.findUnique({
      where: { id: idString },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            role: true
          }
        },
        portfolio: {
          orderBy: { orderIndex: 'asc' }
        },
        packages: {
          orderBy: { createdAt: 'asc' }
        },
        reviews: {
          include: {
            author: {
              select: { id: true, name: true, avatarUrl: true }
            }
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!talentProfile) {
      throw new NotFoundError('Profil talent non trouvé');
    }

    ApiResponse.success(res, talentProfile);
  } catch (error) {
    next(error);
  }
};

// Get talent profile by userId
export const getTalentProfileByUserId = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.params;
    const userIdString = Array.isArray(userId) ? userId[0] : userId;

    const talentProfile = await prisma.talentProfile.findUnique({
      where: { userId: userIdString },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            role: true
          }
        },
        portfolio: {
          orderBy: { orderIndex: 'asc' }
        },
        packages: {
          orderBy: { createdAt: 'asc' }
        },
        reviews: {
          include: {
            author: {
              select: { id: true, name: true, avatarUrl: true }
            }
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!talentProfile) {
      throw new NotFoundError('Profil talent non trouvé pour cet utilisateur');
    }

    ApiResponse.success(res, talentProfile);
  } catch (error) {
    next(error);
  }
};
