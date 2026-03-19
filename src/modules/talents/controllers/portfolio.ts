import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { NotFoundError, ForbiddenError } from '../../../utils/errors';
import { mapPortfolioTagToContentType } from '../../../utils/contentTypeMapper';

// Add portfolio item
export const addPortfolioItem = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { talentId } = req.params;
    const talentIdString = Array.isArray(talentId) ? talentId[0] : talentId;
    const { title, thumbnail, videoUrl, type, views, duration, orderIndex, tag } = req.body;

    // Verify talent profile exists and belongs to user
    const talentProfile = await prisma.talentProfile.findUnique({
      where: { id: talentIdString }
    });

    if (!talentProfile) {
      throw new NotFoundError('Profil talent non trouvé');
    }

    if (talentProfile.userId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new ForbiddenError('Vous n\'avez pas la permission d\'ajouter un item au portfolio');
    }

    // Map legacy tag to new ContentType system (supports both)
    const contentType = tag ? mapPortfolioTagToContentType(tag) : null;

    // Create portfolio item
    const portfolioItem = await prisma.portfolioItem.create({
      data: {
        talentId: talentIdString,
        title,
        thumbnail,
        videoUrl,
        type,
        views,
        duration,
        orderIndex: orderIndex || 0,
        tag, // Keep legacy field
        contentType // Set new ContentType field
      }
    });

    ApiResponse.created(res, portfolioItem, 'Item ajouté au portfolio avec succès');
  } catch (error) {
    next(error);
  }
};

// Update portfolio item
export const updatePortfolioItem = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const idString = Array.isArray(id) ? id[0] : id;
    const { title, thumbnail, videoUrl, type, views, duration, orderIndex, tag } = req.body;

    // Verify portfolio item exists
    const portfolioItem = await prisma.portfolioItem.findUnique({
      where: { id: idString },
      include: { talent: true }
    });

    if (!portfolioItem) {
      throw new NotFoundError('Item de portfolio non trouvé');
    }

    if (portfolioItem.talent.userId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new ForbiddenError('Vous n\'avez pas la permission de modifier cet item');
    }

    // Map legacy tag to new ContentType system (supports both)
    const contentType = tag ? mapPortfolioTagToContentType(tag) : undefined;

    // Update item
    const updatedItem = await prisma.portfolioItem.update({
      where: { id: idString },
      data: {
        title,
        thumbnail,
        videoUrl,
        type,
        views,
        duration,
        orderIndex,
        tag, // Keep legacy field
        contentType // Set new ContentType field
      }
    });

    ApiResponse.success(res, updatedItem, 'Item mis à jour avec succès');
  } catch (error) {
    next(error);
  }
};

// Delete portfolio item
export const deletePortfolioItem = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const idString = Array.isArray(id) ? id[0] : id;

    // Verify portfolio item exists
    const portfolioItem = await prisma.portfolioItem.findUnique({
      where: { id: idString },
      include: { talent: true }
    });

    if (!portfolioItem) {
      throw new NotFoundError('Item de portfolio non trouvé');
    }

    if (portfolioItem.talent.userId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new ForbiddenError('Vous n\'avez pas la permission de supprimer cet item');
    }

    await prisma.portfolioItem.delete({
      where: { id: idString }
    });

    ApiResponse.success(res, null, 'Item supprimé avec succès');
  } catch (error) {
    next(error);
  }
};

// Reorder portfolio items
export const reorderPortfolioItems = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { talentId } = req.params;
    const talentIdString = Array.isArray(talentId) ? talentId[0] : talentId;
    const { itemIds } = req.body; // Array of portfolio item IDs in desired order

    // Verify talent profile exists
    const talentProfile = await prisma.talentProfile.findUnique({
      where: { id: talentIdString }
    });

    if (!talentProfile) {
      throw new NotFoundError('Profil talent non trouvé');
    }

    if (talentProfile.userId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new ForbiddenError('Vous n\'avez pas la permission de réorganiser ce portfolio');
    }

    // Update order index for each item
    const updatePromises = itemIds.map((itemId: string, index: number) =>
      prisma.portfolioItem.update({
        where: { id: itemId },
        data: { orderIndex: index }
      })
    );

    await Promise.all(updatePromises);

    // Fetch updated portfolio
    const updatedPortfolio = await prisma.portfolioItem.findMany({
      where: { talentId: talentIdString },
      orderBy: { orderIndex: 'asc' }
    });

    ApiResponse.success(res, updatedPortfolio, 'Portfolio réorganisé avec succès');
  } catch (error) {
    next(error);
  }
};
