/**
 * TUS (Resumable Upload Protocol) Configuration
 *
 * Provides resumable, chunked uploads for large video files.
 * Uses Google Cloud Storage as the backend store.
 *
 * Features:
 * - Chunked uploads (8MB default)
 * - Automatic resume on network failure
 * - Progress tracking
 * - 24-hour upload session expiry
 */

import { Server, Upload } from '@tus/server';
import { GCSStore } from '@tus/gcs-store';
import { Storage } from '@google-cloud/storage';
import { MemoryLocker } from '@tus/server';
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Configuration
const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'toftal-clip-media';
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'toftal-clip-api';
const KEY_FILE = process.env.GCS_KEY_FILE;
const IS_CLOUD_RUN = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';

// TUS Configuration
export const TUS_CONFIG = {
  // Maximum file size: 10GB
  maxSize: 10 * 1024 * 1024 * 1024,

  // Upload expiration: 24 hours
  expirationPeriodInMilliseconds: 24 * 60 * 60 * 1000,

  // Path where TUS uploads are handled
  path: '/api/v1/tus',

  // Chunk size: 8MB (optimal for GCS)
  chunkSize: 8 * 1024 * 1024,
};

// Initialize GCS Storage
const storage = IS_CLOUD_RUN
  ? new Storage({ projectId: PROJECT_ID })
  : new Storage({ projectId: PROJECT_ID, keyFilename: KEY_FILE || './gcs-key.json' });

// Create GCS Store for TUS
// Note: GCSStore stores files directly in the bucket root with the upload ID as filename
const gcsStore = new GCSStore({
  bucket: storage.bucket(BUCKET_NAME),
});

/**
 * Generate upload ID with metadata
 */
const namingFunction = (req: any, metadata?: Record<string, string | null>): string => {
  const timestamp = Date.now();
  const uuid = uuidv4();
  // Prefix with tus-uploads/ to organize files
  return `tus-uploads/${timestamp}_${uuid}`;
};

/**
 * Handle upload creation - validate and set up
 */
const onUploadCreate = async (req: any, upload: Upload): Promise<{ metadata?: Record<string, string | null> }> => {
  console.log('🎬 TUS Upload created:', upload.id);
  console.log('📋 Metadata:', upload.metadata);

  // Validate file type from metadata
  const metadata = upload.metadata || {};
  const filetype = metadata.filetype || '';

  const allowedTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska'];

  if (filetype && !allowedTypes.includes(filetype)) {
    throw {
      status_code: 415,
      body: `Unsupported file type: ${filetype}. Allowed: ${allowedTypes.join(', ')}`
    };
  }

  // Validate file size
  if (upload.size && upload.size > TUS_CONFIG.maxSize) {
    throw {
      status_code: 413,
      body: `File too large. Maximum size: ${TUS_CONFIG.maxSize / (1024 * 1024 * 1024)}GB`
    };
  }

  return { metadata: upload.metadata };
};

/**
 * Handle upload completion - move file and register in database
 */
const onUploadFinish = async (req: any, upload: Upload): Promise<{
  status_code?: number;
  headers?: Record<string, string | number>;
  body?: string;
}> => {
  console.log('🎬 TUS Upload completed:', upload.id);
  console.log('📦 Size:', upload.size, 'bytes');
  console.log('📋 Metadata:', upload.metadata);

  try {
    // Extract metadata from upload
    const metadata = upload.metadata || {};
    const filename = metadata.filename || 'video.mp4';
    const deliverableId = metadata.deliverableId;
    const userId = metadata.userId;
    const versionNumber = metadata.versionNumber ? parseInt(metadata.versionNumber) : 1;

    // The file is stored with the upload.id as the path
    const tusFilePath = upload.id;
    const ext = filename.substring(filename.lastIndexOf('.')) || '.mp4';
    const finalFilePath = `videos/${uuidv4()}${ext}`;

    // Move/rename file in GCS to final location
    const sourceFile = storage.bucket(BUCKET_NAME).file(tusFilePath);
    const destinationFile = storage.bucket(BUCKET_NAME).file(finalFilePath);

    // Check if source exists
    const [exists] = await sourceFile.exists();
    if (exists) {
      await sourceFile.copy(destinationFile);
      await sourceFile.delete();
      console.log('✅ File moved to:', finalFilePath);
    } else {
      console.log('⚠️ Source file not found, may already be moved:', tusFilePath);
    }

    // Generate public URL
    const videoUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${finalFilePath}`;

    // If deliverableId is provided, create/update version in database
    if (deliverableId && userId) {
      console.log('📝 Registering version for deliverable:', deliverableId);

      // Create version record
      const version = await prisma.version.create({
        data: {
          deliverableId,
          versionNumber,
          videoUrl,
          status: 'PROCESSING',
          uploadedById: userId,
          metadata: {
            fileSize: upload.size || 0,
            originalFileName: filename,
          },
        },
      });

      console.log('✅ Version created:', version.id);

      // Return version info in response headers
      return {
        status_code: 204,
        headers: {
          'X-Version-Id': version.id,
          'X-Video-Url': videoUrl,
          'X-Final-Url': videoUrl,
        },
      };
    }

    // Return final URL in response headers
    return {
      status_code: 204,
      headers: {
        'X-Final-Url': videoUrl,
      },
    };
  } catch (error) {
    console.error('❌ TUS onUploadFinish error:', error);
    // Don't throw - upload is complete, return success
    return { status_code: 204 };
  }
};

/**
 * Create and configure TUS Server
 */
export const createTusServer = (): Server => {
  const tusServer = new Server({
    path: TUS_CONFIG.path,
    datastore: gcsStore,
    maxSize: TUS_CONFIG.maxSize,
    locker: new MemoryLocker(),
    // Allow clients to delete uploads
    allowedHeaders: [
      'Authorization',
      'X-Tus-Token',
      'Upload-Length',
      'Upload-Offset',
      'Tus-Resumable',
      'Upload-Metadata',
      'Upload-Concat',
      'Upload-Defer-Length',
      'X-Requested-With',
      'X-HTTP-Method-Override',
      'Content-Type',
    ],
    // Expose these headers to client
    exposedHeaders: [
      'Upload-Offset',
      'Location',
      'Upload-Length',
      'Tus-Version',
      'Tus-Resumable',
      'Tus-Max-Size',
      'Tus-Extension',
      'Upload-Metadata',
      'X-Final-Url',
      'X-Version-Id',
      'X-Video-Url',
    ],
    // Custom naming function to organize uploads
    namingFunction,
    // Event handlers
    onUploadCreate,
    onUploadFinish,
  });

  return tusServer;
};

/**
 * Get upload progress for a specific upload ID
 */
export const getUploadProgress = async (uploadId: string): Promise<{
  id: string;
  offset: number;
  size: number | null;
  percentage: number;
  status: 'uploading' | 'completed' | 'not_found';
} | null> => {
  try {
    const file = storage.bucket(BUCKET_NAME).file(uploadId);
    const [exists] = await file.exists();

    if (!exists) {
      // Check if moved to final location (videos folder)
      const [files] = await storage.bucket(BUCKET_NAME).getFiles({
        prefix: 'videos/',
        maxResults: 100,
      });

      // Try to find the file by checking metadata or recent files
      // This is a simplified approach - in production you'd track this in DB
      return null;
    }

    const [metadata] = await file.getMetadata();
    const offset = Number(metadata.size) || 0;
    const size = metadata.metadata?.uploadLength ? Number(metadata.metadata.uploadLength) : null;

    return {
      id: uploadId,
      offset,
      size,
      percentage: size ? Math.round((offset / size) * 100) : 0,
      status: 'uploading',
    };
  } catch (error) {
    console.error('Error getting upload progress:', error);
    return null;
  }
};

export { gcsStore, storage, BUCKET_NAME };
