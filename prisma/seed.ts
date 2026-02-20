import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Create default admin user
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@toftalclip.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123!';

  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (existingAdmin) {
    console.log('✅ Admin user already exists:', adminEmail);
  } else {
    const hashedPassword = await bcrypt.hash(adminPassword, 12);

    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: hashedPassword,
        name: 'Admin ToftalClip',
        role: 'ADMIN',
      },
    });

    console.log('✅ Admin user created:');
    console.log('   Email:', admin.email);
    console.log('   Password:', adminPassword);
    console.log('   Role:', admin.role);
  }

  console.log('🌱 Seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
