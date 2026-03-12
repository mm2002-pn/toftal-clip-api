import { Storage } from '@google-cloud/storage';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Configuration
const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'toftal-clip-media';
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'toftal-clip-api';
const KEY_FILE = process.env.GCS_KEY_FILE;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Initialize storage
// In production (Cloud Run), use Application Default Credentials
// In development, use service account key file
const storage = IS_PRODUCTION
  ? new Storage({ projectId: PROJECT_ID })
  : new Storage({ projectId: PROJECT_ID, keyFilename: KEY_FILE || './gcs-key.json' });

const bucket = storage.bucket(BUCKET_NAME);

export interface GCSUploadResult {
  url: string;
  publicUrl: string;
  fileName: string;
  bucket: string;
  contentType: string;
  size: number;
}

/**
 * Upload a file to Google Cloud Storage
 */
export const uploadToGCS = async (
  filePath: string,
  originalName: string,
  mimeType: string,
  folder: string = 'uploads'
): Promise<GCSUploadResult> => {
  // Generate unique filename
  const ext = path.extname(originalName);
  const fileName = `${folder}/${uuidv4()}${ext}`;

  // Upload file
  await bucket.upload(filePath, {
    destination: fileName,
    metadata: {
      contentType: mimeType,
      metadata: {
        originalName: originalName,
        uploadedAt: new Date().toISOString(),
      },
    },
  });

  const file = bucket.file(fileName);

  // Get file metadata for size
  const [metadata] = await file.getMetadata();

  // Generate signed URL (valid for 7 days) or public URL
  const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${fileName}`;

  return {
    url: publicUrl,
    publicUrl,
    fileName,
    bucket: BUCKET_NAME,
    contentType: mimeType,
    size: Number(metadata.size) || 0,
  };
};

/**
 * Upload image to GCS
 */
export const uploadImageToGCS = async (
  filePath: string,
  originalName: string
): Promise<GCSUploadResult> => {
  const ext = path.extname(originalName).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
  };
  const mimeType = mimeTypes[ext] || 'image/jpeg';

  return uploadToGCS(filePath, originalName, mimeType, 'images');
};

/**
 * Upload video to GCS
 */
export const uploadVideoToGCS = async (
  filePath: string,
  originalName: string
): Promise<GCSUploadResult> => {
  const ext = path.extname(originalName).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
  };
  const mimeType = mimeTypes[ext] || 'video/mp4';

  return uploadToGCS(filePath, originalName, mimeType, 'videos');
};

/**
 * Upload PDF/Document to GCS
 */
export const uploadDocumentToGCS = async (
  filePath: string,
  originalName: string
): Promise<GCSUploadResult> => {
  const ext = path.extname(originalName).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
  };
  const mimeType = mimeTypes[ext] || 'application/octet-stream';

  return uploadToGCS(filePath, originalName, mimeType, 'documents');
};

/**
 * Generate a signed URL for temporary access (read)
 */
export const getSignedUrl = async (
  fileName: string,
  expiresInMinutes: number = 60
): Promise<string> => {
  const file = bucket.file(fileName);

  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
  });

  return signedUrl;
};

/**
 * Generate a signed URL for upload (write)
 */
export const getUploadSignedUrl = async (
  fileName: string,
  contentType: string,
  expiresInMinutes: number = 60
): Promise<{ signedUrl: string; publicUrl: string }> => {
  // Generate unique filename with folder structure
  const ext = path.extname(fileName);
  const uniqueFileName = `videos/${uuidv4()}${ext}`;

  const file = bucket.file(uniqueFileName);

  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
    contentType: contentType,
  });

  const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${uniqueFileName}`;

  return {
    signedUrl,
    publicUrl,
  };
};

/**
 * Delete a file from GCS
 */
export const deleteFromGCS = async (fileName: string): Promise<void> => {
  const file = bucket.file(fileName);
  await file.delete({ ignoreNotFound: true });
};

/**
 * Check if file exists
 */
export const fileExistsInGCS = async (fileName: string): Promise<boolean> => {
  const file = bucket.file(fileName);
  const [exists] = await file.exists();
  return exists;
};

/**
 * Make bucket files publicly readable (call once during setup)
 */
export const makeBucketPublic = async (): Promise<void> => {
  await bucket.makePublic();
};

export { storage, bucket, BUCKET_NAME };
