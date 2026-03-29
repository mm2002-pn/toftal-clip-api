import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // 🚨 PROTECTION: Ne pas exécuter en PRODUCTION
  const nodeEnv = process.env.NODE_ENV;
  const databaseUrl = process.env.DATABASE_URL || '';

  console.log(`\n🔍 Environment: ${nodeEnv}`);
  console.log(`🔍 Database: ${databaseUrl.substring(0, 30)}...`);

  // Vérifier si on est en production
  const isProduction = nodeEnv === 'production' || databaseUrl.includes('cloudsql') || databaseUrl.includes('.run.app');

  if (isProduction) {
    console.error('\n❌❌❌ ERREUR: EXÉCUTION EN PRODUCTION DÉTECTÉE! ❌❌❌');
    console.error('❌ Ce script NE DOIT PAS être exécuté en production.');
    console.error('❌ Il va créer 50 utilisateurs de TEST dans la base de données!');
    console.error('\n✅ Solution: Exécuter uniquement en développement/staging');
    console.error('✅ Ou passer la variable: ALLOW_TEST_USERS_IN_PROD=true\n');

    // Permettre un override explicite (avec confirmation)
    if (process.env.ALLOW_TEST_USERS_IN_PROD !== 'true') {
      process.exit(1);
    }

    console.warn('⚠️  Override détecté: ALLOW_TEST_USERS_IN_PROD=true');
    console.warn('⚠️  Création des utilisateurs de test en production...\n');
  }

  console.log('🚀 Creating 50 test users for load testing...\n');

  const BATCH_SIZE = 50;
  const PASSWORD = 'LoadTest@123!';
  const hashedPassword = await bcrypt.hash(PASSWORD, 10);

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (let i = 1; i <= BATCH_SIZE; i++) {
    const email = `loadtest_user${i}@test.com`;
    const name = `Load Test User ${i}`;

    try {
      const user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: {
          email,
          passwordHash: hashedPassword,
          name,
          role: 'USER',
          emailVerified: true, // Enable directly for testing
        },
      });

      console.log(`✅ User ${i}/50 created: ${email}`);
      successCount++;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Unique constraint')) {
        console.log(`⏭️  User ${i}/50 already exists: ${email}`);
        skipCount++;
      } else {
        console.error(`❌ Error creating user ${i}: ${email}`, error);
        errorCount++;
      }
    }
  }

  await prisma.$disconnect();

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Created: ${successCount}`);
  console.log(`⏭️  Already existed: ${skipCount}`);
  console.log(`❌ Errors: ${errorCount}`);
  console.log(`✔️  Total available: ${successCount + skipCount}`);
  console.log('='.repeat(60));
  console.log('\n🎉 Test users ready! Password: LoadTest@123!');
  console.log('🔑 Credentials format: loadtest_user{1-50}@test.com\n');
}

main().catch((e) => {
  console.error('❌ Fatal error:', e);
  process.exit(1);
});
