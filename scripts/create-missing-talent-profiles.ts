import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createMissingTalentProfiles() {
  try {
    console.log('🔍 Checking for users with talentModeEnabled but no TalentProfile...');

    // Find all users with talentModeEnabled = true
    const usersWithTalentMode = await prisma.user.findMany({
      where: { talentModeEnabled: true },
      include: { talentProfile: true },
    });

    console.log(`📊 Found ${usersWithTalentMode.length} users with talent mode enabled`);

    // Filter users without TalentProfile
    const usersWithoutProfile = usersWithTalentMode.filter(user => !user.talentProfile);

    if (usersWithoutProfile.length === 0) {
      console.log('✅ All users with talent mode have a TalentProfile');
      return;
    }

    console.log(`⚠️  Found ${usersWithoutProfile.length} users without TalentProfile:`);
    usersWithoutProfile.forEach(user => {
      console.log(`   - ${user.name} (${user.email}) - ID: ${user.id}`);
    });

    // Create missing profiles
    console.log('\n🔧 Creating missing TalentProfiles...');
    let created = 0;

    for (const user of usersWithoutProfile) {
      try {
        await prisma.talentProfile.create({
          data: {
            userId: user.id,
            bio: null,
            tagline: null,
            location: null,
            languages: [],
            skills: [],
            expertise: [],
            tags: [],
            rating: 0,
            reviewsCount: 0,
            completedProjects: 0,
          },
        });
        console.log(`   ✅ Created TalentProfile for ${user.name}`);
        created++;
      } catch (error) {
        console.error(`   ❌ Failed to create TalentProfile for ${user.name}:`, error);
      }
    }

    console.log(`\n✨ Successfully created ${created}/${usersWithoutProfile.length} TalentProfiles`);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the migration
createMissingTalentProfiles()
  .then(() => {
    console.log('\n🎉 Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration failed:', error);
    process.exit(1);
  });
