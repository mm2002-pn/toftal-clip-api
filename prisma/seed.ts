import { PrismaClient, ContentType } from '@prisma/client';
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

    // Ensure email is verified
    if (!existingAdmin.emailVerified) {
      await prisma.user.update({
        where: { email: adminEmail },
        data: { emailVerified: true }
      });
      console.log('✅ Admin email verified');
    }
  } else {
    const hashedPassword = await bcrypt.hash(adminPassword, 12);

    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: hashedPassword,
        name: 'Admin ToftalClip',
        role: 'ADMIN',
        emailVerified: true,
      },
    });

    console.log('✅ Admin user created:');
    console.log('   Email:', admin.email);
    console.log('   Password:', adminPassword);
    console.log('   Role:', admin.role);
    console.log('   Email Verified: ✅');
  }

  // Seed VideoFormatSpecs
  console.log('\n🎬 Seeding VideoFormatSpecs...');

  // SHORT_FORM
  await prisma.videoFormatSpec.upsert({
    where: { contentType: ContentType.SHORT_FORM },
    update: {},
    create: {
      contentType: ContentType.SHORT_FORM,
      minWidth: 1080,
      minHeight: 1920,
      aspectRatio: '9:16',
      minDuration: 5,
      maxDuration: 60,
      recommendedCodec: 'H.264',
      recommendedBitrate: 5000,
      description: 'Montages verticaux pour TikTok, Instagram Reels',
      label: 'Short Form',
      icon: '📱'
    }
  });
  console.log('✅ SHORT_FORM spec created');

  // LONG_FORM
  await prisma.videoFormatSpec.upsert({
    where: { contentType: ContentType.LONG_FORM },
    update: {},
    create: {
      contentType: ContentType.LONG_FORM,
      minWidth: 1920,
      minHeight: 1080,
      aspectRatio: '16:9',
      minDuration: 300,
      maxDuration: null,
      recommendedCodec: 'H.264',
      recommendedBitrate: 8000,
      description: 'Édition narrative pour YouTube et documentaires',
      label: 'Long Form',
      icon: '🎬'
    }
  });
  console.log('✅ LONG_FORM spec created');

  // PODCAST
  await prisma.videoFormatSpec.upsert({
    where: { contentType: ContentType.PODCAST },
    update: {},
    create: {
      contentType: ContentType.PODCAST,
      minWidth: 1080,
      minHeight: 1080,
      aspectRatio: '1:1',
      minDuration: 600,
      maxDuration: null,
      recommendedCodec: 'AAC',
      recommendedBitrate: 128,
      description: 'Contenu audio et vidéo pour podcasts',
      label: 'Podcast',
      icon: '🎙️'
    }
  });
  console.log('✅ PODCAST spec created');

  // THUMBNAIL
  await prisma.videoFormatSpec.upsert({
    where: { contentType: ContentType.THUMBNAIL },
    update: {},
    create: {
      contentType: ContentType.THUMBNAIL,
      minWidth: 1280,
      minHeight: 720,
      aspectRatio: '16:9',
      minDuration: 0,
      maxDuration: 0,
      recommendedCodec: 'JPEG/PNG',
      recommendedBitrate: 0,
      description: 'Miniatures optimisées pour aperçus YouTube',
      label: 'Thumbnail',
      icon: '🖼️'
    }
  });
  console.log('✅ THUMBNAIL spec created');

  console.log('\n🌱 Seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
