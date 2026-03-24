import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateRoles() {
  try {
    console.log('✅ Connected to database');

    // Check current state
    console.log('\n📊 Checking current users...');
    const allUsers = await prisma.$queryRaw`
      SELECT role, COUNT(*) as count
      FROM "User"
      GROUP BY role
    `;
    console.log('Current roles:', allUsers);

    // Update CLIENT users to USER
    console.log('\n🔄 Updating CLIENT users to USER...');
    const clientUpdate = await prisma.$executeRaw`
      UPDATE "User"
      SET role = 'USER'::"UserRole", "talentModeEnabled" = false
      WHERE role = 'CLIENT'::"UserRole"
    `;
    console.log(`✅ Updated ${clientUpdate} CLIENT users`);

    // Update TALENT users to USER with talentModeEnabled
    console.log('\n🔄 Updating TALENT users to USER...');
    const talentUpdate = await prisma.$executeRaw`
      UPDATE "User"
      SET
        role = 'USER'::"UserRole",
        "talentModeEnabled" = true,
        "talentActivationDate" = COALESCE("talentActivationDate", CURRENT_TIMESTAMP)
      WHERE role = 'TALENT'::"UserRole"
    `;
    console.log(`✅ Updated ${talentUpdate} TALENT users`);

    // Verify final state
    console.log('\n📊 Final role distribution:');
    const finalRoles = await prisma.$queryRaw`
      SELECT role, "talentModeEnabled", COUNT(*) as count
      FROM "User"
      GROUP BY role, "talentModeEnabled"
    `;
    console.log(finalRoles);

    console.log('\n✅ Migration completed successfully!');
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

migrateRoles();
