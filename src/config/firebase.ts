import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Initialize Firebase Admin SDK
// Options:
// 1. FIREBASE_SERVICE_ACCOUNT env var (JSON string)
// 2. firebase-service-account.json file in project root
// 3. Project ID only (limited functionality)

let firebaseApp: admin.app.App;

const initializeFirebase = () => {
  if (admin.apps.length > 0) {
    return admin.apps[0]!;
  }

  // Option 1: Check env variable
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccountJson) {
    try {
      const serviceAccount = JSON.parse(serviceAccountJson);
      console.log('✅ Firebase Admin initialized with service account from env');
      return admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
    } catch (error) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT env:', error);
    }
  }

  // Option 2: Check for JSON file
  const serviceAccountPath = join(process.cwd(), 'firebase-service-account.json');
  if (existsSync(serviceAccountPath)) {
    try {
      const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
      console.log('✅ Firebase Admin initialized with service account file');
      return admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
    } catch (error) {
      console.error('Failed to read firebase-service-account.json:', error);
    }
  }

  // Option 3: Fallback with project ID only
  console.warn('⚠️ Firebase Admin initialized with project ID only - token verification may fail');
  return admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || 'toftal-clip',
  });
};

firebaseApp = initializeFirebase();

export const firebaseAdmin = admin;
export const firebaseAuth = admin.auth();

export default firebaseApp;
