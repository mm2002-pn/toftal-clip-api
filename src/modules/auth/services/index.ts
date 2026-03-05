import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../../../config/database';
import { config } from '../../../config';
import { firebaseAuth } from '../../../config/firebase';
import { sendEmail, emailTemplates } from '../../../config/email';
import { ConflictError, UnauthorizedError, NotFoundError, BadRequestError } from '../../../utils/errors';

interface RegisterInput {
  email: string;
  password: string;
  name: string;
  role?: 'CLIENT' | 'TALENT';
  emailVerified?: boolean; // True when registering via invitation
}

interface LoginInput {
  email: string;
  password: string;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    avatarUrl: string | null;
    authProvider?: string;
    emailVerified?: boolean;
  };
  tokens: AuthTokens | null;
  emailSent?: boolean;
}

// Generate JWT tokens
const generateTokens = (userId: string, email: string, role: string): AuthTokens => {
  const accessToken = jwt.sign(
    { id: userId, email, role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  const refreshToken = jwt.sign(
    { id: userId, email, role },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn }
  );

  return { accessToken, refreshToken };
};

// Generate email verification token
const generateVerificationToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

// Register new user
export const register = async (input: RegisterInput): Promise<AuthResponse> => {
  const { email, password, name, role = 'CLIENT', emailVerified = false } = input;

  console.log('📝 Register attempt');
  console.log('📧 Email:', email);
  console.log('👤 Name:', name);
  console.log('🎭 Role:', role);
  console.log('✉️ Email Verified (from invitation):', emailVerified);

  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    console.error('❌ User already exists:', email);
    throw new ConflictError('User with this email already exists');
  }

  console.log('✅ User does not exist, proceeding with registration')

  // Hash password
  const salt = await bcrypt.genSalt(12);
  const passwordHash = await bcrypt.hash(password, salt);

  // Generate verification token (even if email is pre-verified, in case they need resend)
  const emailVerificationToken = generateVerificationToken();
  const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      role,
      emailVerified: emailVerified, // Use the passed value (true for invitations, false for normal signup)
      emailVerificationToken,
      emailVerificationExpires,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      avatarUrl: true,
      authProvider: true,
      emailVerified: true,
    },
  });

  // If talent, create talent profile
  if (role === 'TALENT') {
    await prisma.talentProfile.create({
      data: {
        userId: user.id,
      },
    });
  }

  // Send verification email
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const verificationUrl = `${frontendUrl}/#/verify-email?token=${emailVerificationToken}`;

  let emailSent = false;
  try {
    await sendEmail(email, emailTemplates.verification(name, verificationUrl));
    emailSent = true;
    console.log(`✅ Verification email sent to ${email}`);
  } catch (error) {
    console.error('❌ Failed to send verification email:', error);
    // Don't throw - user is created, they can request a new email
  }

  // Only generate tokens if email is pre-verified (e.g., from invitation)
  // For normal signups, user must verify email first
  let tokens = null;
  if (user.emailVerified) {
    tokens = generateTokens(user.id, user.email, user.role);
  }

  return {
    user: { ...user, authProvider: user.authProvider, emailVerified: user.emailVerified },
    tokens,
    emailSent
  };
};

// Verify email with token
export const verifyEmail = async (token: string): Promise<{ message: string; emailToken: string }> => {
  const user = await prisma.user.findFirst({
    where: {
      emailVerificationToken: token,
      emailVerificationExpires: {
        gt: new Date(),
      },
    },
  });

  if (!user) {
    throw new BadRequestError('Token de vérification invalide ou expiré');
  }

  // Store the token before clearing it (needed for invitation acceptance)
  const emailToken = user.emailVerificationToken!;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null,
    },
  });

  return { message: 'Email vérifié avec succès', emailToken };
};

// Resend verification email
export const resendVerificationEmail = async (email: string): Promise<{ message: string }> => {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    // Don't reveal if user exists
    return { message: 'Si cet email existe, un nouveau lien de vérification a été envoyé' };
  }

  if (user.emailVerified) {
    throw new BadRequestError('Cet email est déjà vérifié');
  }

  // Generate new token
  const emailVerificationToken = generateVerificationToken();
  const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerificationToken,
      emailVerificationExpires,
    },
  });

  // Send verification email
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const verificationUrl = `${frontendUrl}/#/verify-email?token=${emailVerificationToken}`;

  await sendEmail(email, emailTemplates.verification(user.name, verificationUrl));

  return { message: 'Si cet email existe, un nouveau lien de vérification a été envoyé' };
};

// Login user
export const login = async (input: LoginInput): Promise<AuthResponse> => {
  const { email, password } = input;

  console.log('🔐 Login attempt');
  console.log('📧 Email:', email);

  // Find user
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    console.error('❌ User not found:', email);
    throw new UnauthorizedError('Invalid email or password');
  }

  console.log('✅ User found:', user.id);

  // Check if user uses Google auth
  if (!user.passwordHash) {
    console.error('❌ User uses Google auth');
    throw new UnauthorizedError('This account uses Google Sign-In. Please use the Google button to login.');
  }

  // Verify password
  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

  if (!isPasswordValid) {
    console.error('❌ Password invalid');
    throw new UnauthorizedError('Invalid email or password');
  }

  console.log('✅ Password valid');

  // Check if email is verified
  if (!user.emailVerified) {
    console.error('❌ Email not verified:', user.emailVerified);
    throw new UnauthorizedError('Veuillez vérifier votre email avant de vous connecter. Vérifiez votre boîte de réception.');
  }

  console.log('✅ Email verified');

  // Generate tokens
  const tokens = generateTokens(user.id, user.email, user.role);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
      authProvider: user.authProvider,
    },
    tokens,
  };
};

// Refresh access token
export const refreshAccessToken = async (refreshToken: string): Promise<AuthTokens> => {
  try {
    const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as {
      id: string;
      email: string;
      role: string;
    };

    // Check if user still exists
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
    });

    if (!user) {
      throw new UnauthorizedError('User no longer exists');
    }

    // Generate new tokens
    return generateTokens(user.id, user.email, user.role);
  } catch (error) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }
};

// Get current user
export const getCurrentUser = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      avatarUrl: true,
      authProvider: true,
      accountStatus: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  return user;
};

// Change password
export const changePassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Check if user has a password (not Google auth)
  if (!user.passwordHash) {
    throw new BadRequestError('Cannot change password for Google-authenticated accounts');
  }

  // Verify current password
  const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);

  if (!isPasswordValid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  // Hash new password
  const salt = await bcrypt.genSalt(12);
  const passwordHash = await bcrypt.hash(newPassword, salt);

  // Update password
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });
};

// Login/Register with Google (Firebase)
interface GoogleAuthInput {
  idToken: string;
  role?: 'CLIENT' | 'TALENT';
}

export const loginWithGoogle = async (input: GoogleAuthInput): Promise<AuthResponse> => {
  const { idToken, role = 'CLIENT' } = input;

  // Verify Firebase ID token
  let decodedToken;
  try {
    decodedToken = await firebaseAuth.verifyIdToken(idToken);
  } catch (error) {
    throw new UnauthorizedError('Invalid Firebase token');
  }

  const { uid, email, name, picture } = decodedToken;

  if (!email) {
    throw new BadRequestError('Email is required for authentication');
  }

  // Check if user exists by Firebase UID
  let user = await prisma.user.findUnique({
    where: { firebaseUid: uid },
  });

  if (!user) {
    // Check if user exists by email (might have registered with email/password before)
    user = await prisma.user.findUnique({
      where: { email },
    });

    if (user) {
      // Link Google account to existing user
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          firebaseUid: uid,
          authProvider: 'google',
          avatarUrl: user.avatarUrl || picture || null,
        },
      });
    } else {
      // Create new user
      user = await prisma.user.create({
        data: {
          email,
          name: name || email.split('@')[0],
          role,
          authProvider: 'google',
          firebaseUid: uid,
          avatarUrl: picture || null,
        },
      });

      // If talent, create talent profile
      if (role === 'TALENT') {
        await prisma.talentProfile.create({
          data: {
            userId: user.id,
          },
        });
      }
    }
  }

  // Generate JWT tokens
  const tokens = generateTokens(user.id, user.email, user.role);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
      authProvider: user.authProvider,
    },
    tokens,
  };
};
