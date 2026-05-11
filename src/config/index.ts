import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // Server
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  apiVersion: process.env.API_VERSION || 'v1',

  // Database
  databaseUrl: process.env.DATABASE_URL || '',

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'default-refresh-secret-change-me',
    expiresIn: (process.env.JWT_EXPIRES_IN || '1h') as `${number}${'s' | 'm' | 'h' | 'd'}`, // 1 hour access token
    refreshExpiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '30d') as `${number}${'s' | 'm' | 'h' | 'd'}`, // 30 days refresh token
  },

  // Cloudinary
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },

  // Groq AI
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: {
      powerful: 'llama-3.3-70b-versatile',  // Complex reasoning
      fast: 'llama-3.1-8b-instant',          // Quick tasks
      whisper: 'whisper-large-v3-turbo',     // Audio transcription
    },
  },

  // CORS - supports comma or semicolon-separated origins
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(/[,;]/).map(s => s.trim()).filter(s => s),

  // Frontend URL (for emails and redirects)
  frontendUrl: process.env.FRONTEND_URL || process.env.CORS_ORIGIN?.split(/[,;]/)[0]?.trim() || 'http://localhost:3000',

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '1000', 10), // Increased from 100 to 1000 for load testing
  },

  // Logging
  logLevel: process.env.LOG_LEVEL || 'debug',

  // Is Production
  isProduction: process.env.NODE_ENV === 'production',

  // Bictorys (payment processor) — keys come from Cloud Run secrets in prod
  // and from .env locally. apiUrl differs between sandbox (api.test...) and
  // live; default to test so a misconfigured prod loudly hits sandbox rather
  // than charging real cards.
  bictorys: {
    publicKey: process.env.BICTORYS_PUBLIC_KEY || '',
    secretKey: process.env.BICTORYS_SECRET_KEY || '',
    webhookSecret: process.env.BICTORYS_WEBHOOK_SECRET || '',
    apiUrl: process.env.BICTORYS_API_URL || 'https://api.test.bictorys.com',
  },

  // Google Cloud — project / region / Cloud Run Jobs settings.
  // `region` defaults to europe-west1 because that's where our Cloud Run
  // services live; if we ever multi-region, the Job must run in the same
  // region as the GCS bucket to keep egress free.
  gcp: {
    projectId: process.env.GCP_PROJECT_ID || '',
    region: process.env.GCP_REGION || 'europe-west1',
    /**
     * Name of the Cloud Run Job that runs the faststart remux pipeline.
     * Different per environment so staging never triggers prod's Job and
     * vice-versa. Set in cloudbuild yamls.
     */
    faststartJobName: process.env.FASTSTART_JOB_NAME || 'faststart-worker',
    /**
     * Name of the Cloud Run Job that runs the HLS multi-quality encode
     * pipeline. Tuned with more CPU/RAM/timeout than faststart since
     * ffmpeg here actually re-encodes (CPU-bound, not just remux).
     */
    hlsJobName: process.env.HLS_JOB_NAME || 'hls-worker',
    /**
     * Name of the Cloud Run Job that produces the lightweight 480p
     * mobile-friendly preview MP4. Highest CPU sizing of the three
     * because its job is to be the FIRST artefact ready, not the
     * highest quality.
     */
    previewJobName: process.env.PREVIEW_JOB_NAME || 'preview-worker',
    /**
     * Name of the Cloud Run Job that downscales a single Version to a
     * target quality (720p/1080p/2K/…) on demand when a user clicks
     * Download. Each execution downscales exactly one (versionId,
     * quality) pair — dedup is enforced in the DB.
     */
    downscaleJobName: process.env.DOWNSCALE_JOB_NAME || 'toftal-downscale-staging',
  },

  // Media URLs — served via Cloud CDN once the load balancer is in place.
  // Worker writes this base into Version.videoUrl for new remuxed files
  // so playback hits the CDN. Falls back to direct GCS in dev.
  media: {
    bucketName: process.env.GCS_BUCKET_NAME || 'toftal-clip-media',
    /**
     * Public base URL for serving media. With CDN: `https://media.staging.toftalclip.io/`.
     * Without CDN: `https://storage.googleapis.com/<bucket>/`. MUST end with `/`.
     */
    publicBaseUrl:
      process.env.MEDIA_PUBLIC_BASE_URL ||
      `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME || 'toftal-clip-media'}/`,
  },

  // Internal service-to-service auth — used by the faststart worker
  // (Cloud Run Job, separate process) to ask the API to emit a Socket.IO
  // event to project rooms. The Job has no in-memory access to the io
  // instance, so it POSTs `/api/v1/internal/version-ready` with the
  // shared secret in `X-Internal-Secret`. The API validates and re-emits.
  //
  // The secret is mounted from Secret Manager on both the API service
  // and the Job; it must be the same value for the auth to pass.
  // `apiBaseUrl` is set on the Job only (worker → API direction).
  internal: {
    apiSecret: process.env.INTERNAL_API_SECRET || '',
    apiBaseUrl: process.env.INTERNAL_API_BASE_URL || '',
  },
};
