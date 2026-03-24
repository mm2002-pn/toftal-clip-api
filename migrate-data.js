const { Client } = require('pg');

async function migrateRoles() {
  const client = new Client({
    connectionString: 'postgresql://postgres:root@localhost:5432/toftal_studio_db'
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Check current state
    console.log('\n📊 Current role distribution:');
    const currentRoles = await client.query('SELECT role, COUNT(*) FROM "User" GROUP BY role');
    console.table(currentRoles.rows);

    // Update CLIENT users to USER
    console.log('\n🔄 Updating CLIENT users to USER...');
    const clientUpdate = await client.query(`
      UPDATE "User"
      SET role = 'USER', "talentModeEnabled" = false
      WHERE role = 'CLIENT'
      RETURNING id, email, role, "talentModeEnabled"
    `);
    console.log(`✅ Updated ${clientUpdate.rowCount} CLIENT users`);

    // Update TALENT users to USER
    console.log('\n🔄 Updating TALENT users to USER...');
    const talentUpdate = await client.query(`
      UPDATE "User"
      SET
        role = 'USER',
        "talentModeEnabled" = true,
        "talentActivationDate" = COALESCE("talentActivationDate", CURRENT_TIMESTAMP)
      WHERE role = 'TALENT'
      RETURNING id, email, role, "talentModeEnabled"
    `);
    console.log(`✅ Updated ${talentUpdate.rowCount} TALENT users`);

    // Verify final state
    console.log('\n📊 Final role distribution:');
    const finalRoles = await client.query('SELECT role, "talentModeEnabled", COUNT(*) FROM "User" GROUP BY role, "talentModeEnabled"');
    console.table(finalRoles.rows);

    console.log('\n✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrateRoles();
