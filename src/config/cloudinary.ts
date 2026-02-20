import { v2 as cloudinary } from 'cloudinary';
import { config } from './index';
import { logger } from '../utils/logger';

// Configure Cloudinary
cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
  secure: true,
});

// Upload options for different file types
export const uploadOptions = {
  image: {
    folder: 'toftal-clip/images',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    transformation: [
      { width: 1920, height: 1080, crop: 'limit' },
      { quality: 'auto' },
      { fetch_format: 'auto' },
    ],
  },
  video: {
    folder: 'toftal-clip/videos',
    resource_type: 'video' as const,
    allowed_formats: ['mp4', 'mov', 'avi', 'webm'],
    chunk_size: 6000000, // 6MB chunks for large files
    eager: [
      { width: 1280, height: 720, crop: 'limit', format: 'mp4' },
    ],
    eager_async: true,
  },
  document: {
    folder: 'toftal-clip/documents',
    resource_type: 'raw' as const,
    // No format restrictions for raw uploads - accept all document types
  },
  avatar: {
    folder: 'toftal-clip/avatars',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [
      { width: 400, height: 400, crop: 'fill', gravity: 'face' },
      { quality: 'auto' },
      { fetch_format: 'auto' },
    ],
  },
};

// Upload file to Cloudinary
export const uploadToCloudinary = async (
  filePath: string,
  options: Record<string, any> = {}
): Promise<any> => {
  try {
    const result = await cloudinary.uploader.upload(filePath, options);
    logger.info(`File uploaded to Cloudinary: ${result.public_id}`);
    return result;
  } catch (error) {
    logger.error('Cloudinary upload error:', error);
    throw error;
  }
};

// Upload video to Cloudinary
export const uploadVideoToCloudinary = async (
  filePath: string,
  options: Record<string, any> = {}
): Promise<any> => {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      ...uploadOptions.video,
      ...options,
    });
    logger.info(`Video uploaded to Cloudinary: ${result.public_id}`);
    return result;
  } catch (error) {
    logger.error('Cloudinary video upload error:', error);
    throw error;
  }
};

// Delete file from Cloudinary
export const deleteFromCloudinary = async (
  publicId: string,
  resourceType: 'image' | 'video' | 'raw' = 'image'
): Promise<any> => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });
    logger.info(`File deleted from Cloudinary: ${publicId}`);
    return result;
  } catch (error) {
    logger.error('Cloudinary delete error:', error);
    throw error;
  }
};

// Generate signed URL for private resources
export const generateSignedUrl = (
  publicId: string,
  options: Record<string, any> = {}
): string => {
  return cloudinary.url(publicId, {
    sign_url: true,
    secure: true,
    ...options,
  });
};

// Generate signature for direct frontend upload
export const generateUploadSignature = (
  folder: string = 'toftal-clip/uploads',
  resourceType: 'image' | 'video' | 'raw' = 'image'
): { signature: string; timestamp: number; cloudName: string; apiKey: string; folder: string } => {
  const timestamp = Math.round(new Date().getTime() / 1000);

  const paramsToSign = {
    timestamp,
    folder,
  };

  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    config.cloudinary.apiSecret
  );

  return {
    signature,
    timestamp,
    cloudName: config.cloudinary.cloudName,
    apiKey: config.cloudinary.apiKey,
    folder,
  };
};

export default cloudinary;
