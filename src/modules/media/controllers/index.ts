import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { socketService } from '../../../services/socketService';
import {
  uploadToCloudinary,
  deleteFromCloudinary,
  generateUploadSignature,
  uploadOptions
} from '../../../config/cloudinary';
import {
  uploadImageToGCS,
  uploadVideoToGCS,
  uploadDocumentToGCS,
  deleteFromGCS,
  getSignedUrl,
  getUploadSignedUrl
} from '../../../config/gcs';
import fs from 'fs';

/**
 * Upload file - All files go to Google Cloud Storage
 * - Images → Google Cloud Storage
 * - Videos → Google Cloud Storage
 * - Audio → Google Cloud Storage
 * - Documents → Google Cloud Storage
 */
export const uploadFile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) {
      return ApiResponse.badRequest(res, 'No file uploaded') as any;
    }

    const mimeType = req.file.mimetype;
    let result: any;
    let gcsResult;

    // Images → Google Cloud Storage
    if (mimeType.startsWith('image/')) {
      gcsResult = await uploadImageToGCS(req.file.path, req.file.originalname);
      result = {
        url: gcsResult.url,
        fileName: gcsResult.fileName,
        format: gcsResult.contentType,
        size: gcsResult.size,
        provider: 'gcs',
      };
    }
    // Videos → Google Cloud Storage
    else if (mimeType.startsWith('video/')) {
      gcsResult = await uploadVideoToGCS(req.file.path, req.file.originalname);
      result = {
        url: gcsResult.url,
        fileName: gcsResult.fileName,
        format: gcsResult.contentType,
        size: gcsResult.size,
        provider: 'gcs',
      };
    }
    // Audio → Google Cloud Storage
    else if (mimeType.startsWith('audio/')) {
      gcsResult = await uploadDocumentToGCS(req.file.path, req.file.originalname);
      result = {
        url: gcsResult.url,
        fileName: gcsResult.fileName,
        format: gcsResult.contentType,
        size: gcsResult.size,
        provider: 'gcs',
      };
    }
    // Documents (PDF, etc.) → Google Cloud Storage
    else {
      gcsResult = await uploadDocumentToGCS(req.file.path, req.file.originalname);
      result = {
        url: gcsResult.url,
        fileName: gcsResult.fileName,
        format: gcsResult.contentType,
        size: gcsResult.size,
        provider: 'gcs',
      };
    }

    // Delete local file
    fs.unlinkSync(req.file.path);

    ApiResponse.success(res, result, 'File uploaded successfully');
  } catch (error) {
    // Clean up local file on error
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    next(error);
  }
};

/**
 * Upload video specifically to Google Cloud Storage
 */
export const uploadVideo = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) {
      return ApiResponse.badRequest(res, 'No file uploaded') as any;
    }

    const gcsResult = await uploadVideoToGCS(req.file.path, req.file.originalname);

    // Delete local file
    fs.unlinkSync(req.file.path);

    ApiResponse.success(res, {
      url: gcsResult.url,
      fileName: gcsResult.fileName,
      format: gcsResult.contentType,
      size: gcsResult.size,
      provider: 'gcs',
    }, 'Video uploaded successfully');
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    next(error);
  }
};

/**
 * Delete media from appropriate provider
 */
export const deleteMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    const media = await prisma.mediaResource.findUnique({ where: { id } });

    if (media) {
      // Determine provider from URL
      if (media.url.includes('storage.googleapis.com')) {
        // Extract fileName from GCS URL
        const fileName = media.url.replace(`https://storage.googleapis.com/toftal-clip-media/`, '');
        await deleteFromGCS(fileName);
      } else if (media.url.includes('cloudinary.com')) {
        // Extract publicId from Cloudinary URL
        // This is simplified - ideally store publicId in DB
        const publicId = media.url.split('/').slice(-1)[0].split('.')[0];
        await deleteFromCloudinary(publicId);
      }

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

/**
 * Get signature for direct upload to Cloudinary (images only)
 */
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

/**
 * Get signed URL for GCS upload (write access)
 */
export const getGCSSignedUrl = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { fileName, contentType, expiresInMinutes } = req.body;

    if (!fileName) {
      return ApiResponse.badRequest(res, 'fileName is required') as any;
    }

    if (!contentType) {
      return ApiResponse.badRequest(res, 'contentType is required') as any;
    }

    const result = await getUploadSignedUrl(fileName, contentType, expiresInMinutes || 60);

    ApiResponse.success(res, result, 'Upload signed URL generated');
  } catch (error) {
    next(error);
  }
};

/**
 * Register media after frontend uploads
 */
export const registerMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { projectId, deliverableId, name, url, publicId, type, category, tags } = req.body;

    const media = await prisma.mediaResource.create({
      data: {
        projectId,
        deliverableId,
        name,
        url,
        type: type || 'IMAGE',
        category,
        tags: tags || [],
        addedBy: req.user!.id,
      },
    });

    // Emit real-time notification for media upload
    const mediaPayload = {
      id: media.id,
      projectId,
      deliverableId,
      name,
      url,
      type: type || 'IMAGE',
      category,
    };

    console.log('[SOCKET] Emitting media:added for project:', projectId, mediaPayload);

    // Emit to project room
    socketService.emitToProject(projectId, 'media:added', mediaPayload);

    // Also emit to deliverable room if specified (for real-time updates on detail page)
    if (deliverableId) {
      socketService.emitToProject(projectId, 'media:added', mediaPayload);
    }

    ApiResponse.created(res, media, 'Media registered successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Get media for a project
 */
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
