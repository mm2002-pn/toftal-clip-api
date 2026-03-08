import { prisma } from '../../../config/database';

interface CreateBetaSignupInput {
  name: string;
  email: string;
  contact: string;
  role?: string;
  videoCount?: string;
  collaboration?: string;
  biggestProblem?: string;
  interests?: string[];
  feedbackReady?: string;
  link?: string;
  marketplaceInterest?: string;
  source?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Create a beta signup entry
 * @throws Error if email already exists
 */
export const createBetaSignup = async (data: CreateBetaSignupInput) => {
  // Check if email already exists
  const existingSignup = await prisma.betaSignup.findUnique({
    where: { email: data.email },
  });

  if (existingSignup) {
    throw new Error('Email already registered for beta');
  }

  // Create signup record
  const signup = await prisma.betaSignup.create({
    data: {
      name: data.name.trim(),
      email: data.email.toLowerCase().trim(),
      contact: data.contact.trim(),
      role: data.role?.trim(),
      videoCount: data.videoCount?.trim(),
      collaboration: data.collaboration?.trim(),
      biggestProblem: data.biggestProblem?.trim(),
      interests: data.interests || [],
      feedbackReady: data.feedbackReady?.trim(),
      link: data.link?.trim(),
      marketplaceInterest: data.marketplaceInterest?.trim(),
      source: data.source?.trim(),
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      status: 'PENDING',
    },
  });

  return signup;
};

/**
 * Get all beta signups (admin only)
 */
export const getAllBetaSignups = async (
  skip: number = 0,
  take: number = 20,
  status?: string
) => {
  const where = status ? { status } : {};

  const [signups, total] = await Promise.all([
    prisma.betaSignup.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.betaSignup.count({ where }),
  ]);

  return {
    signups,
    total,
    page: Math.floor(skip / take) + 1,
    pageSize: take,
    totalPages: Math.ceil(total / take),
  };
};

/**
 * Get a single beta signup
 */
export const getBetaSignup = async (id: string) => {
  return prisma.betaSignup.findUnique({
    where: { id },
  });
};

/**
 * Update beta signup status
 */
export const updateBetaSignupStatus = async (
  id: string,
  status: string,
  notes?: string
) => {
  return prisma.betaSignup.update({
    where: { id },
    data: {
      status,
      notes: notes || undefined,
      updatedAt: new Date(),
    },
  });
};

/**
 * Delete beta signup
 */
export const deleteBetaSignup = async (id: string): Promise<void> => {
  await prisma.betaSignup.delete({
    where: { id },
  });
};
