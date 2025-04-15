const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

// Create data directory if it doesn't exist
const dataDir = path.resolve(__dirname, "../data");
if (!fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`Created data directory at ${dataDir}`);
  } catch (err) {
    console.error(`Failed to create data directory: ${err.message}`);
    process.exit(1);
  }
}

// Database connection
const dbPath = path.resolve(__dirname, "../data/questions.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error connecting to database:", err.message);
    process.exit(1);
  }
  console.log("Connected to the questions database.");
});

// Run migrations in sequence
async function runMigrations() {
  try {
    // Migration 1: Add api_key column to users table
    await addApiKeyColumn();

    // Migration 2: Add state column to users table
    await addStateColumn();

    // Migration 3: Add created_at column to users table
    await addCreatedAtColumn();

    console.log("All migrations completed successfully");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    db.close();
  }
}

// Add api_key column to users table if it doesn't exist
async function addApiKeyColumn() {
  return new Promise((resolve, reject) => {
    // Check if column exists
    db.all("PRAGMA table_info(users)", (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      // Check if api_key column exists
      const hasApiKey = rows.some((col) => col.name === "api_key");

      if (!hasApiKey) {
        console.log("Adding api_key column to users table...");
        db.run("ALTER TABLE users ADD COLUMN api_key TEXT", (err) => {
          if (err) {
            reject(err);
          } else {
            console.log("✅ api_key column added successfully");
            resolve();
          }
        });
      } else {
        console.log("api_key column already exists");
        resolve();
      }
    });
  });
}

// Add state column to users table if it doesn't exist
async function addStateColumn() {
  return new Promise((resolve, reject) => {
    // Check if column exists
    db.all("PRAGMA table_info(users)", (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      // Check if state column exists
      const hasState = rows.some((col) => col.name === "state");

      if (!hasState) {
        console.log("Adding state column to users table...");
        db.run(
          "ALTER TABLE users ADD COLUMN state TEXT DEFAULT 'IDLE'",
          (err) => {
            if (err) {
              reject(err);
            } else {
              console.log("✅ state column added successfully");
              resolve();
            }
          }
        );
      } else {
        console.log("state column already exists");
        resolve();
      }
    });
  });
}

// Add created_at column to users table if it doesn't exist
async function addCreatedAtColumn() {
  return new Promise((resolve, reject) => {
    // Check if column exists
    db.all("PRAGMA table_info(users)", (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      // Check if created_at column exists
      const hasCreatedAt = rows.some((col) => col.name === "created_at");

      if (!hasCreatedAt) {
        console.log("Adding created_at column to users table...");
        // SQLite doesn't support DEFAULT CURRENT_TIMESTAMP in ALTER TABLE
        db.run("ALTER TABLE users ADD COLUMN created_at TIMESTAMP", (err) => {
          if (err) {
            reject(err);
          } else {
            // Set current timestamp for existing rows
            db.run(
              "UPDATE users SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL",
              (err) => {
                if (err) {
                  reject(err);
                } else {
                  console.log("✅ created_at column added successfully");
                  resolve();
                }
              }
            );
          }
        });
      } else {
        console.log("created_at column already exists");
        resolve();
      }
    });
  });
}

// Run migrations
runMigrations();
