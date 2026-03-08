import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.findUnique({
    where: { email: 'admin@toftalclip.com' },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      emailVerified: true
    }
  });

  console.log('\n👤 Admin User Details:');
  console.log('─'.repeat(50));
  if (admin) {
    console.log(`✅ Email:         ${admin.email}`);
    console.log(`✅ Name:          ${admin.name}`);
    console.log(`✅ Role:          ${admin.role}`);
    console.log(`✅ Email Verified: ${admin.emailVerified}`);
    console.log(`✅ ID:            ${admin.id}`);
  } else {
    console.log('❌ Admin not found');
  }
  console.log('─'.repeat(50) + '\n');

  await prisma.$disconnect();
}

main().catch(e => console.error('Error:', e.message));
