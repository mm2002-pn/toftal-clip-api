import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { ForbiddenError } from '../../../utils/errors';

export const createProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { bio, location, languages, skills, videoType, startingPrice } = req.body;

    const profile = await prisma.talentProfile.create({
      data: {
        userId: req.user!.id,
        bio,
        location,
        languages,
        skills,
        videoType,
        startingPrice,
      },
    });

    ApiResponse.created(res, profile, 'Profile created');
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { bio, location, languages, skills, videoType, responseTime, startingPrice, coverImage } = req.body;

    const profile = await prisma.talentProfile.findUnique({ where: { id } });
    if (profile?.userId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new ForbiddenError('Cannot update this profile');
    }

    const updated = await prisma.talentProfile.update({
      where: { id },
      data: { bio, location, languages, skills, videoType, responseTime, startingPrice, coverImage },
    });

    ApiResponse.success(res, updated, 'Profile updated');
  } catch (error) {
    next(error);
  }
};

export const addPortfolioItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { thumbnail, title, views } = req.body;

    const item = await prisma.portfolioItem.create({
      data: { talentId: id, thumbnail, title, views },
    });

    ApiResponse.created(res, item, 'Portfolio item added');
  } catch (error) {
    next(error);
  }
};

export const deletePortfolioItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const itemId = String(req.params.itemId);
    await prisma.portfolioItem.delete({ where: { id: itemId } });
    ApiResponse.success(res, null, 'Portfolio item deleted');
  } catch (error) {
    next(error);
  }
};

export const addPackage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { name, price, description, features, isPopular } = req.body;

    const pkg = await prisma.package.create({
      data: { talentId: id, name, price, description, features, isPopular },
    });

    ApiResponse.created(res, pkg, 'Package added');
  } catch (error) {
    next(error);
  }
};

export const updatePackage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const packageId = String(req.params.packageId);
    const { name, price, description, features, isPopular } = req.body;

    const pkg = await prisma.package.update({
      where: { id: packageId },
      data: { name, price, description, features, isPopular },
    });

    ApiResponse.success(res, pkg, 'Package updated');
  } catch (error) {
    next(error);
  }
};

export const deletePackage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const packageId = String(req.params.packageId);
    await prisma.package.delete({ where: { id: packageId } });
    ApiResponse.success(res, null, 'Package deleted');
  } catch (error) {
    next(error);
  }
};

export const addReview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { rating, text } = req.body;

    const review = await prisma.review.create({
      data: { talentId: id, authorId: req.user!.id, rating, text },
    });

    // Update talent rating
    const reviews = await prisma.review.findMany({ where: { talentId: id } });
    const avgRating = reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length;

    await prisma.talentProfile.update({
      where: { id },
      data: { rating: avgRating, reviewsCount: reviews.length },
    });

    ApiResponse.created(res, review, 'Review added');
  } catch (error) {
    next(error);
  }
};
