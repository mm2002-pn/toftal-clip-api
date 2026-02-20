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
// Direct Upload (Recommended - Frontend -> Cloudinary)
// ============================================
router.post('/signature', validate(signatureValidation), mediaController.getUploadSignature);
router.post('/register', validate(registerMediaValidation), mediaController.registerMedia);

// ============================================
// Server Upload (Fallback - Frontend -> Backend -> Cloudinary)
// ============================================
router.post('/upload', uploadLimiter, uploadAny.single('file'), mediaController.uploadFile);
router.post('/upload/video', uploadLimiter, uploadAny.single('file'), mediaController.uploadVideo);

// ============================================
// Delete
// ============================================
router.delete('/:id', mediaController.deleteMedia);

export default router;
