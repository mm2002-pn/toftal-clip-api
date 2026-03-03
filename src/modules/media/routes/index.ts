import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth';
import { uploadLimiter } from '../../../middlewares/rateLimiter';
import { validate } from '../../../middlewares/validate';
import { uploadAny } from '../../../middlewares/upload';
import * as mediaController from '../controllers';
import { signatureValidation, registerMediaValidation } from '../validators';

const router = Router();

router.use(authenticate);

// ============================================
// Direct Upload Signatures
// ============================================
// Cloudinary signature (for images)
router.post('/signature', validate(signatureValidation), mediaController.getUploadSignature);
// GCS signed URL (for private video/document access)
router.post('/gcs/signed-url', mediaController.getGCSSignedUrl);

// ============================================
// Register media in database
// ============================================
router.post('/register', validate(registerMediaValidation), mediaController.registerMedia);

// ============================================
// Server Upload
// Images → Cloudinary | Videos/PDFs → Google Cloud Storage
// ============================================
router.post('/upload', uploadLimiter, uploadAny.single('file'), mediaController.uploadFile);
router.post('/upload/video', uploadLimiter, uploadAny.single('file'), mediaController.uploadVideo);

// ============================================
// Delete (auto-detects provider from URL)
// ============================================
router.delete('/:id', mediaController.deleteMedia);

export default router;
