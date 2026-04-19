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
import { FileStore } from '@tus/file-store';
import { Storage } from '@google-cloud/storage';
import { MemoryLocker } from '@tus/server';
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import { unlinkSync, existsSync } from 'fs';
import cacheService from '../services/cacheService';

const prisma = new PrismaClient();

// Configuration
const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'toftal-clip-media';
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'toftal-clip-api';
const KEY_FILE = process.env.GCS_KEY_FILE;
const IS_CLOUD_RUN = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';

// Local TUS upload directory (hybrid approach: FileStore + GCS transfer)
const TUS_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'tus-temp');
if (!fs.existsSync(TUS_UPLOAD_DIR)) {
  fs.mkdirSync(TUS_UPLOAD_DIR, { recursive: true });
  console.log('📁 Created TUS upload directory:', TUS_UPLOAD_DIR);
}

// Cache key prefix for TUS uploads
const TUS_CACHE_PREFIX = 'tus:transfer:';
const TUS_CACHE_TTL = 86400; // 24 hours

// Track GCS transfer progress for polling
export interface GcsTransferStatus {
  status: 'pending' | 'transferring' | 'completed' | 'error';
  progress: number; // 0-100
  bytesTransferred: number;
  totalBytes: number;
  error?: string;
  gcsUrl?: string;
  createdAt: number; // timestamp
}

// In-memory fallback + Redis persistence
const gcsTransferProgressMemory = new Map<string, GcsTransferStatus>();

export const getGcsTransferProgress = async (uploadId: string): Promise<GcsTransferStatus | null> => {
  // Try memory first (faster)
  const memoryValue = gcsTransferProgressMemory.get(uploadId);
  if (memoryValue) return memoryValue;

  // Try Redis
  const redisValue = await cacheService.get<GcsTransferStatus>(`${TUS_CACHE_PREFIX}${uploadId}`);
  if (redisValue) {
    // Cache in memory for faster access
    gcsTransferProgressMemory.set(uploadId, redisValue);
    return redisValue;
  }

  return null;
};

export const setGcsTransferProgress = async (uploadId: string, status: GcsTransferStatus): Promise<void> => {
  // Set in memory
  gcsTransferProgressMemory.set(uploadId, status);
  // Persist to Redis
  await cacheService.set(`${TUS_CACHE_PREFIX}${uploadId}`, status, TUS_CACHE_TTL);
};

export const clearGcsTransferProgress = async (uploadId: string): Promise<void> => {
  gcsTransferProgressMemory.delete(uploadId);
  await cacheService.delete(`${TUS_CACHE_PREFIX}${uploadId}`);
};

/**
 * Check if an upload can be resumed
 * Returns true if the upload exists and can be continued
 */
export const canResumeUpload = async (uploadId: string): Promise<{
  canResume: boolean;
  status?: GcsTransferStatus;
  fileExists?: boolean;
  reason?: string;
}> => {
  // Check if local file exists
  const localFilePath = path.join(TUS_UPLOAD_DIR, uploadId);
  const fileExists = existsSync(localFilePath);

  // Check TUS metadata file to see if upload is complete
  const metaFilePath = `${localFilePath}.json`;
  let tusMetadata: { size?: number; offset?: number } | null = null;
  if (existsSync(metaFilePath)) {
    try {
      const metaContent = fs.readFileSync(metaFilePath, 'utf-8');
      tusMetadata = JSON.parse(metaContent);
    } catch {
      // Ignore parse errors
    }
  }

  // Check GCS transfer status in Redis
  const status = await getGcsTransferProgress(uploadId);

  // Case 1: GCS transfer completed - don't resume, start fresh
  if (status?.status === 'completed') {
    return { canResume: false, status: status || undefined, fileExists, reason: 'transfer_completed' };
  }

  // Case 2: GCS transfer errored - don't resume, start fresh
  if (status?.status === 'error') {
    return { canResume: false, status: status || undefined, fileExists, reason: 'transfer_error' };
  }

  // Case 3: GCS transfer in progress - can resume
  if (status?.status === 'transferring' || status?.status === 'pending') {
    return { canResume: true, status: status || undefined, fileExists, reason: 'transfer_in_progress' };
  }

  // Case 4: File exists but TUS upload not complete (offset < size) - can resume TUS upload
  if (fileExists && tusMetadata) {
    const fileStats = fs.statSync(localFilePath);
    const currentSize = fileStats.size;
    const expectedSize = tusMetadata.size || 0;

    if (currentSize < expectedSize) {
      // TUS upload is incomplete, can resume
      return { canResume: true, fileExists, reason: 'tus_incomplete' };
    }

    // File is complete but no GCS transfer status - stale upload, start fresh
    console.log(`⚠️ Stale upload detected: ${uploadId} (file complete but no GCS status)`);
    return { canResume: false, fileExists, reason: 'stale_upload' };
  }

  // Case 5: File exists but no metadata - can't determine state, start fresh
  if (fileExists && !tusMetadata) {
    return { canResume: false, fileExists, reason: 'no_metadata' };
  }

  // Case 6: Nothing exists - start fresh
  return { canResume: false, reason: 'not_found' };
};

// TUS Configuration
export const TUS_CONFIG = {
  // Maximum file size: 10GB
  maxSize: 10 * 1024 * 1024 * 1024,

  // Upload expiration: 24 hours
  expirationPeriodInMilliseconds: 24 * 60 * 60 * 1000,

  // Path where TUS uploads are handled
  // Full public path - we prepend this in the route handler
  path: '/api/v1/tus',

  // Chunk size: 8MB (optimal for GCS)
  chunkSize: 8 * 1024 * 1024,
};

// Initialize GCS Storage
const storage = IS_CLOUD_RUN
  ? new Storage({ projectId: PROJECT_ID })
  : new Storage({ projectId: PROJECT_ID, keyFilename: KEY_FILE || './gcs-key.json' });

// Create FileStore for TUS (hybrid approach: FileStore + GCS transfer)
// This is more reliable than direct GCSStore which has known issues with PATCH requests
const fileStore = new FileStore({
  directory: TUS_UPLOAD_DIR,
});
console.log('📁 TUS using FileStore with directory:', TUS_UPLOAD_DIR);
console.log('☁️ Files will be transferred to GCS bucket:', BUCKET_NAME, 'on completion');

/**
 * Generate upload ID with metadata
 * FileStore uses this as the filename directly (no slashes allowed)
 */
const namingFunction = (req: any, metadata?: Record<string, string | null>): string => {
  const timestamp = Date.now();
  const uuid = uuidv4();
  return `${timestamp}_${uuid}`;
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
 * Transfer file to GCS in background (non-blocking)
 */
const transferToGcsInBackground = async (uploadId: string, upload: Upload) => {
  const metadata = upload.metadata || {};
  const filename = metadata.filename || 'video.mp4';
  const deliverableId = metadata.deliverableId;
  const userId = metadata.userId;
  const versionNumber = metadata.versionNumber ? parseInt(metadata.versionNumber) : 1;

  const localFilePath = path.join(TUS_UPLOAD_DIR, uploadId);
  const ext = filename.substring(filename.lastIndexOf('.')) || '.mp4';
  const finalGcsPath = `videos/${uuidv4()}${ext}`;

  console.log('📁 Local file path:', localFilePath);
  console.log('☁️ Target GCS path:', finalGcsPath);

  try {
    // Check if local file exists
    if (!existsSync(localFilePath)) {
      console.error('❌ Local file not found:', localFilePath);
      await setGcsTransferProgress(uploadId, {
        status: 'error',
        progress: 0,
        bytesTransferred: 0,
        totalBytes: 0,
        error: 'Fichier local introuvable',
        createdAt: Date.now(),
      });
      return;
    }

    // Get file size for progress tracking
    const fileStats = fs.statSync(localFilePath);
    const totalBytes = fileStats.size;

    // Upload file to GCS with progress tracking
    const bucket = storage.bucket(BUCKET_NAME);
    const gcsFile = bucket.file(finalGcsPath);

    console.log('⬆️ Starting GCS upload in background...');

    // Initialize progress tracking
    const initialStatus: GcsTransferStatus = {
      status: 'transferring',
      progress: 0,
      bytesTransferred: 0,
      totalBytes,
      createdAt: Date.now(),
    };
    gcsTransferProgressMemory.set(uploadId, initialStatus);
    setGcsTransferProgress(uploadId, initialStatus).catch(console.error);

    // Stream upload with progress
    await new Promise<void>((resolve, reject) => {
      const readStream = fs.createReadStream(localFilePath);
      const writeStream = gcsFile.createWriteStream({
        resumable: true,
        metadata: {
          contentType: metadata.filetype || 'video/mp4',
          metadata: {
            originalFileName: filename,
            uploadedAt: new Date().toISOString(),
          },
        },
      });

      let bytesTransferred = 0;
      let lastRedisUpdate = 0;
      let isCompleted = false;

      const completeUpload = (gcsUrl: string) => {
        if (isCompleted) return;
        isCompleted = true;

        console.log('✅ GCS upload completed for:', uploadId);
        const finalStatus: GcsTransferStatus = {
          status: 'completed',
          progress: 100,
          bytesTransferred: totalBytes,
          totalBytes,
          gcsUrl,
          createdAt: Date.now(),
        };
        gcsTransferProgressMemory.set(uploadId, finalStatus);
        setGcsTransferProgress(uploadId, finalStatus).catch(console.error);
        resolve();
      };

      readStream.on('data', (chunk: Buffer) => {
        bytesTransferred += chunk.length;
        const progress = Math.round((bytesTransferred / totalBytes) * 100);

        gcsTransferProgressMemory.set(uploadId, {
          status: 'transferring',
          progress,
          bytesTransferred,
          totalBytes,
          createdAt: Date.now(),
        });

        const now = Date.now();
        if (progress % 10 === 0 || now - lastRedisUpdate > 5000) {
          lastRedisUpdate = now;
          setGcsTransferProgress(uploadId, {
            status: 'transferring',
            progress,
            bytesTransferred,
            totalBytes,
            createdAt: Date.now(),
          }).catch(console.error);
        }
      });

      readStream.on('end', () => console.log('📖 ReadStream ended for:', uploadId));
      readStream.on('error', (err) => {
        console.error('❌ ReadStream error:', err);
        reject(err);
      });

      writeStream.on('finish', () => {
        console.log('🏁 WriteStream finish for:', uploadId);
        completeUpload(`https://storage.googleapis.com/${BUCKET_NAME}/${finalGcsPath}`);
      });

      writeStream.on('close', () => {
        console.log('🔒 WriteStream close for:', uploadId);
        setTimeout(() => completeUpload(`https://storage.googleapis.com/${BUCKET_NAME}/${finalGcsPath}`), 100);
      });

      writeStream.on('error', (err) => {
        console.error('❌ WriteStream error:', err);
        const errorStatus: GcsTransferStatus = {
          status: 'error',
          progress: 0,
          bytesTransferred,
          totalBytes,
          error: err.message,
          createdAt: Date.now(),
        };
        gcsTransferProgressMemory.set(uploadId, errorStatus);
        setGcsTransferProgress(uploadId, errorStatus).catch(console.error);
        reject(err);
      });

      readStream.pipe(writeStream);
    });

    // Delete local file after successful GCS upload
    try {
      unlinkSync(localFilePath);
      const metaFilePath = `${localFilePath}.json`;
      if (existsSync(metaFilePath)) unlinkSync(metaFilePath);
      console.log('🗑️ Local file cleaned up');
    } catch (cleanupError) {
      console.warn('⚠️ Failed to cleanup local file:', cleanupError);
    }

    // Generate public URL
    const videoUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${finalGcsPath}`;

    // If deliverableId is provided, create/update version in database
    if (deliverableId && userId) {
      console.log('📝 Registering version for deliverable:', deliverableId);

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
    }
  } catch (error: any) {
    console.error('❌ Background GCS transfer error:', error);
    await setGcsTransferProgress(uploadId, {
      status: 'error',
      progress: 0,
      bytesTransferred: 0,
      totalBytes: 0,
      error: error.message || 'Erreur lors du transfert',
      createdAt: Date.now(),
    });
  }
};

/**
 * Handle upload completion - respond immediately and transfer to GCS in background
 */
const onUploadFinish = async (req: any, upload: Upload): Promise<{
  status_code?: number;
  headers?: Record<string, string | number>;
  body?: string;
}> => {
  console.log('🎬 TUS Upload completed:', upload.id);
  console.log('📦 Size:', upload.size, 'bytes');
  console.log('📋 Metadata:', upload.metadata);

  // Start GCS transfer in background (non-blocking)
  // Don't await - respond immediately to TUS client
  transferToGcsInBackground(upload.id, upload).catch(err => {
    console.error('❌ Background transfer failed:', err);
  });

  // Respond immediately to TUS client
  return {
    status_code: 204,
    headers: {
      'X-Upload-Id': upload.id,
    },
  };
};

/**
 * Create and configure TUS Server
 */
export const createTusServer = (): Server => {
  const tusServer = new Server({
    path: TUS_CONFIG.path,
    datastore: fileStore,
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
      'X-Upload-Id',
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
 * Checks local FileStore for in-progress uploads
 */
export const getUploadProgress = async (uploadId: string): Promise<{
  id: string;
  offset: number;
  size: number | null;
  percentage: number;
  status: 'uploading' | 'completed' | 'not_found';
} | null> => {
  try {
    const localFilePath = path.join(TUS_UPLOAD_DIR, uploadId);
    const metaFilePath = `${localFilePath}.json`;

    // Check if upload is in progress (local file exists)
    if (existsSync(localFilePath)) {
      const stats = fs.statSync(localFilePath);
      const offset = stats.size;

      // Try to read metadata for total size
      let size: number | null = null;
      if (existsSync(metaFilePath)) {
        try {
          const metaContent = fs.readFileSync(metaFilePath, 'utf-8');
          const meta = JSON.parse(metaContent);
          size = meta.size || meta.upload_length || null;
        } catch {
          // Ignore metadata read errors
        }
      }

      return {
        id: uploadId,
        offset,
        size,
        percentage: size ? Math.round((offset / size) * 100) : 0,
        status: 'uploading',
      };
    }

    // File not found locally - might be completed and moved to GCS
    // Check if it's in the videos folder
    const [files] = await storage.bucket(BUCKET_NAME).getFiles({
      prefix: 'videos/',
      maxResults: 10,
    });

    // This is a simplified check - in production, track this in DB
    return null;
  } catch (error) {
    console.error('Error getting upload progress:', error);
    return null;
  }
};

export { fileStore, storage, BUCKET_NAME, TUS_UPLOAD_DIR };
