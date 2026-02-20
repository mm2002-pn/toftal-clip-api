import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';

export const createStudio = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, location, pricePerHour, thumbnail, gallery, tags, description, features, whatsappNumber } = req.body;

    const studio = await prisma.studio.create({
      data: { name, location, pricePerHour, thumbnail, gallery, tags, description, features, whatsappNumber },
    });

    ApiResponse.created(res, studio, 'Studio created');
  } catch (error) {
    next(error);
  }
};

export const updateStudio = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    const studio = await prisma.studio.update({
      where: { id },
      data: req.body,
    });

    ApiResponse.success(res, studio, 'Studio updated');
  } catch (error) {
    next(error);
  }
};

export const deleteStudio = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    await prisma.studio.delete({ where: { id } });
    ApiResponse.success(res, null, 'Studio deleted');
  } catch (error) {
    next(error);
  }
};
