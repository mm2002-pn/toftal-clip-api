import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import {
  uploadToCloudinary,
  uploadVideoToCloudinary,
  deleteFromCloudinary,
  generateUploadSignature,
  uploadOptions
} from '../../../config/cloudinary';
import fs from 'fs';

export const uploadFile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) {
      return ApiResponse.badRequest(res, 'No file uploaded') as any;
    }

    // Determine upload options based on file type
    let options: Record<string, any>;
    const mimeType = req.file.mimetype;

    if (mimeType.startsWith('image/')) {
      options = uploadOptions.image;
    } else if (mimeType.startsWith('video/')) {
      options = uploadOptions.video;
    } else if (mimeType.startsWith('audio/')) {
      options = {
        folder: 'toftal-clip/audio',
        resource_type: 'video' as const, // Cloudinary uses 'video' for audio
      };
    } else {
      // Documents, PDFs, archives, etc.
      options = {
        folder: 'toftal-clip/documents',
        resource_type: 'raw' as const,
      };
    }

    const result = await uploadToCloudinary(req.file.path, options);

    // Delete local file
    fs.unlinkSync(req.file.path);

    ApiResponse.success(res, {
      url: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      width: result.width,
      height: result.height,
      duration: result.duration,
    }, 'File uploaded successfully');
  } catch (error) {
    // Clean up local file on error
    if (req.file?.path) {
      fs.unlinkSync(req.file.path);
    }
    next(error);
  }
};

export const uploadVideo = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) {
      return ApiResponse.badRequest(res, 'No file uploaded') as any;
    }

    const result = await uploadVideoToCloudinary(req.file.path);

    // Delete local file
    fs.unlinkSync(req.file.path);

    ApiResponse.success(res, {
      url: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      duration: result.duration,
    }, 'Video uploaded successfully');
  } catch (error) {
    if (req.file?.path) {
      fs.unlinkSync(req.file.path);
    }
    next(error);
  }
};

export const deleteMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    const media = await prisma.mediaResource.findUnique({ where: { id } });

    if (media) {
      // Extract public ID from URL and delete from Cloudinary
      // This is a simplified version - you'd want to store publicId in DB
      await prisma.mediaResource.delete({ where: { id } });
    }

    ApiResponse.success(res, null, 'Media deleted');
  } catch (error) {
    next(error);
  }
};

// ============================================
// DIRECT UPLOAD (Frontend -> Cloudinary)
// ============================================

// Get signature for direct upload to Cloudinary
export const getUploadSignature = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { folder, resourceType } = req.body;

    const signatureData = generateUploadSignature(
      folder || 'toftal-clip/uploads',
      resourceType || 'image'
    );

    ApiResponse.success(res, signatureData, 'Upload signature generated');
  } catch (error) {
    next(error);
  }
};

// Register media after frontend uploads to Cloudinary
export const registerMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { projectId, deliverableId, name, url, publicId, type, category } = req.body;

    const media = await prisma.mediaResource.create({
      data: {
        projectId,
        deliverableId,
        name,
        url,
        type: type || 'IMAGE',
        category,
        addedBy: req.user!.id,
      },
    });

    ApiResponse.created(res, media, 'Media registered successfully');
  } catch (error) {
    next(error);
  }
};

// Get media for a project (GraphQL preferred, but REST available)
export const getProjectMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const projectId = String(req.params.projectId);

    const media = await prisma.mediaResource.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    ApiResponse.success(res, media);
  } catch (error) {
    next(error);
  }
};
