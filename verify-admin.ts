import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('🔍 Fetching admin user...');
    const admin = await prisma.user.findUnique({
      where: { email: 'admin@toftalclip.com' }
    });

    if (!admin) {
      console.log('❌ Admin not found');
      return;
    }

    console.log('Current status:', {
      email: admin.email,
      emailVerified: admin.emailVerified
    });

    console.log('\n✅ Updating admin email verification...');
    const updated = await prisma.user.update({
      where: { email: 'admin@toftalclip.com' },
      data: { emailVerified: true }
    });

    console.log('✅ Admin email verified successfully!');
    console.log('Updated user:', {
      email: updated.email,
      emailVerified: updated.emailVerified
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
