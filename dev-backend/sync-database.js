const path = require('path');
const fs = require('fs');
require('dotenv').config();
const { sequelize } = require('./config/database');

async function syncDatabase() {
  try {
    await sequelize.authenticate();
    console.log('Database connection established.');

    // Auto-load all models
    const modelsDir = path.join(__dirname, 'models');
    const modelFiles = fs.readdirSync(modelsDir)
      .filter(f => f.endsWith('.js') && f !== 'index.js');

    const models = {};
    for (const file of modelFiles) {
      const model = require(path.join(modelsDir, file));
      if (model && model.name) {
        models[model.name] = model;
      }
    }
    console.log(`${Object.keys(models).length} models loaded: ${Object.keys(models).join(', ')}`);

    // Load associations
    require('./models');

    // Disable FK checks during sync
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');

    const failed = [];
    const succeeded = [];

    for (const [name, model] of Object.entries(models)) {
      try {
        await model.sync({ alter: true });
        succeeded.push(name);
      } catch (error) {
        console.error(`Failed to sync ${name}:`, error.message);
        failed.push(name);
      }
    }

    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');

    console.log(`\nSync complete: ${succeeded.length} succeeded, ${failed.length} failed`);
    if (failed.length > 0) console.log('Failed:', failed.join(', '));

    // Show tables
    const [tables] = await sequelize.query('SHOW TABLES');
    console.log(`\nTables (${tables.length}):`);
    tables.forEach(t => console.log(`  - ${Object.values(t)[0]}`));

    process.exit(0);
  } catch (error) {
    console.error('Sync failed:', error);
    process.exit(1);
  }
}

syncDatabase();
