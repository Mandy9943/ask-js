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
let db;

// Initialize database tables
async function initDatabase() {
  return new Promise((resolve, reject) => {
    // Create database connection
    const dbPath = path.resolve(__dirname, "../data/questions.db");
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error("Error connecting to database:", err.message);
        reject(err);
        return;
      }

      console.log("Connected to the questions database.");

      // Create tables if they don't exist
      db.serialize(async () => {
        // Table for users
        db.run(`CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY,
          chat_id TEXT UNIQUE NOT NULL,
          name TEXT,
          username TEXT,
          joined_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_admin INTEGER DEFAULT 0,
          is_active INTEGER DEFAULT 1,
          is_approved INTEGER DEFAULT 0,
          require_api_key INTEGER DEFAULT 0,
          schedule TEXT DEFAULT "0 9 * * *",
          last_question_date TIMESTAMP
        )`);

        // Table for storing sent questions
        db.run(`CREATE TABLE IF NOT EXISTS sent_questions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          question TEXT NOT NULL,
          answer TEXT NOT NULL,
          category TEXT NOT NULL,
          sent_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )`);

        // Table for bot settings
        db.run(`CREATE TABLE IF NOT EXISTS settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          require_user_approval INTEGER DEFAULT 0,
          require_api_key INTEGER DEFAULT 0,
          max_questions_per_day INTEGER DEFAULT 5
        )`);

        // Initialize settings if they don't exist
        db.get("SELECT * FROM settings WHERE id = 1", (err, row) => {
          if (!row) {
            db.run(`INSERT INTO settings (id, require_user_approval, require_api_key, max_questions_per_day) 
                    VALUES (1, 0, 0, 5)`);
          }
        });

        // Check and add columns if missing
        try {
          await ensureColumnsExist();
        } catch (err) {
          console.error("Error checking/adding columns:", err);
        }

        // Set up admin user from environment
        const adminChatId = process.env.TELEGRAM_CHAT_ID;
        if (adminChatId) {
          db.run(
            `INSERT OR IGNORE INTO users (chat_id, name, is_admin, is_approved) VALUES (?, ?, 1, 1)`,
            [adminChatId, "Admin"],
            (err) => {
              if (err) {
                console.error("Error setting up admin user:", err.message);
                reject(err);
              } else {
                console.log(`Admin user set up with chat_id: ${adminChatId}`);
                resolve();
              }
            }
          );
        } else {
          resolve();
        }
      });
    });
  });
}

// Ensure required columns exist in users table
async function ensureColumnsExist() {
  const columns = [
    { name: "api_key", definition: "TEXT" },
    { name: "state", definition: "TEXT DEFAULT 'IDLE'" },
    { name: "created_at", definition: "TIMESTAMP" },
    { name: "is_approved", definition: "INTEGER DEFAULT 0" },
    { name: "require_api_key", definition: "INTEGER DEFAULT 0" },
  ];

  return new Promise((resolve, reject) => {
    db.all("PRAGMA table_info(users)", async (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      const existingColumns = rows.map((row) => row.name);

      for (const column of columns) {
        if (!existingColumns.includes(column.name)) {
          try {
            await addColumn(column.name, column.definition);

            // Set default values for timestamp columns
            if (column.name === "created_at") {
              await updateColumnDefaultValue(column.name);
            }
          } catch (error) {
            console.error(`Error adding column ${column.name}:`, error);
            reject(error);
            return;
          }
        }
      }

      resolve();
    });
  });
}

// Add a new column to the users table
async function addColumn(name, definition) {
  return new Promise((resolve, reject) => {
    console.log(`Adding ${name} column to users table...`);
    db.run(`ALTER TABLE users ADD COLUMN ${name} ${definition}`, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log(`✅ ${name} column added successfully`);
        resolve();
      }
    });
  });
}

// Update column with default values where null
async function updateColumnDefaultValue(columnName) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users SET ${columnName} = CURRENT_TIMESTAMP WHERE ${columnName} IS NULL`,
      (err) => {
        if (err) {
          reject(err);
        } else {
          console.log(`✅ Default values set for ${columnName}`);
          resolve();
        }
      }
    );
  });
}

// User-related functions
async function getUser(chatId) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM users WHERE chat_id = ?", [chatId], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

async function createUser(chatId, name, username) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(
      "INSERT OR IGNORE INTO users (chat_id, name, username) VALUES (?, ?, ?)"
    );
    stmt.run([chatId, name, username], function (err) {
      if (err) {
        reject(err);
      } else {
        resolve(this.lastID);
      }
    });
    stmt.finalize();
  });
}

async function updateUserSchedule(chatId, schedule) {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE users SET schedule = ? WHERE chat_id = ?",
      [schedule, chatId],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      }
    );
  });
}

async function updateLastQuestionDate(chatId) {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE users SET last_question_date = CURRENT_TIMESTAMP WHERE chat_id = ?",
      [chatId],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      }
    );
  });
}

async function getAllUsers(activeOnly = true) {
  return new Promise((resolve, reject) => {
    const query = activeOnly
      ? "SELECT * FROM users WHERE is_active = 1"
      : "SELECT * FROM users";

    db.all(query, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

async function isAdmin(chatId) {
  const user = await getUser(chatId);
  return user && user.is_active === 1 && user.is_admin === 1;
}

// Question-related functions
async function getAllSentQuestions(userId) {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT * FROM sent_questions WHERE user_id = ?",
      [userId],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      }
    );
  });
}

async function saveQuestion(userId, question, answer, category) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(
      "INSERT INTO sent_questions (user_id, question, answer, category) VALUES (?, ?, ?, ?)"
    );
    stmt.run([userId, question, answer, category], function (err) {
      if (err) {
        reject(err);
      } else {
        resolve(this.lastID);
      }
    });
    stmt.finalize();
  });
}

async function isQuestionUnique(userId, question) {
  const user = await getUser(userId);
  if (!user) return true; // If user not found, consider question unique

  const sentQuestions = await getAllSentQuestions(user.id);
  // Simple check for now - just look for exact matches
  const isSimilar = sentQuestions.some(
    (q) => q.question.toLowerCase() === question.toLowerCase()
  );
  return !isSimilar;
}

async function deleteAllQuestions(userId = null) {
  return new Promise((resolve, reject) => {
    let query = "DELETE FROM sent_questions";
    let params = [];

    if (userId) {
      query += " WHERE user_id = ?";
      params.push(userId);
    }

    db.run(query, params, function (err) {
      if (err) {
        reject(err);
      } else {
        console.log(`Deleted ${this.changes} questions from database`);
        resolve(this.changes);
      }
    });
  });
}

// Add function to set user API key
async function setUserApiKey(chatId, apiKey) {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE users SET api_key = ? WHERE chat_id = ?",
      [apiKey, chatId],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      }
    );
  });
}

// Add function to approve a user
async function approveUser(chatId) {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE users SET is_approved = 1 WHERE chat_id = ?",
      [chatId],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      }
    );
  });
}

// Check if user is approved
async function isApproved(chatId) {
  const user = await getUser(chatId);
  return user && user.is_approved === 1;
}

// Get bot settings
async function getSettings() {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM settings WHERE id = 1", (err, row) => {
      if (err) {
        reject(err);
      } else {
        // If no settings found, return defaults
        if (!row) {
          resolve({
            require_user_approval: 0,
            require_api_key: 0,
            max_questions_per_day: 5,
          });
        } else {
          resolve(row);
        }
      }
    });
  });
}

// Update bot settings
async function updateSettings(settings) {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE settings SET require_user_approval = ?, require_api_key = ?, max_questions_per_day = ? WHERE id = 1",
      [
        settings.require_user_approval,
        settings.require_api_key,
        settings.max_questions_per_day,
      ],
      function (err) {
        if (err) {
          reject(err);
        } else {
          if (this.changes === 0) {
            // Insert if update didn't affect any rows
            db.run(
              "INSERT INTO settings (id, require_user_approval, require_api_key, max_questions_per_day) VALUES (1, ?, ?, ?)",
              [
                settings.require_user_approval,
                settings.require_api_key,
                settings.max_questions_per_day,
              ],
              function (err) {
                if (err) {
                  reject(err);
                } else {
                  resolve(this.lastID);
                }
              }
            );
          } else {
            resolve(this.changes);
          }
        }
      }
    );
  });
}

// Set if a user requires their own API key
async function setUserRequireApiKey(chatId, requireApiKey) {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE users SET require_api_key = ? WHERE chat_id = ?",
      [requireApiKey ? 1 : 0, chatId],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      }
    );
  });
}

// Get a single setting value with default
async function getSetting(key, defaultValue = null) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM settings WHERE id = 1", (err, row) => {
      if (err) {
        console.error(`Error getting setting ${key}:`, err);
        resolve(defaultValue);
      } else {
        // If no settings found, return default
        if (!row || row[key] === undefined) {
          resolve(defaultValue);
        } else {
          resolve(row[key]);
        }
      }
    });
  });
}

// Update a single setting
async function updateSetting(key, value) {
  return new Promise((resolve, reject) => {
    // First check if settings row exists
    db.get("SELECT * FROM settings WHERE id = 1", (err, row) => {
      if (err) {
        console.error(`Error checking settings for ${key}:`, err);
        reject(err);
        return;
      }

      if (!row) {
        // Create settings row if it doesn't exist
        const defaultSettings = {
          require_user_approval: 0,
          require_api_key: 0,
          max_questions_per_day: 5,
        };
        defaultSettings[key] = value;

        db.run(
          "INSERT INTO settings (id, require_user_approval, require_api_key, max_questions_per_day) VALUES (1, ?, ?, ?)",
          [
            defaultSettings.require_user_approval,
            defaultSettings.require_api_key,
            defaultSettings.max_questions_per_day,
          ],
          function (err) {
            if (err) {
              console.error(`Error creating settings for ${key}:`, err);
              reject(err);
            } else {
              resolve(true);
            }
          }
        );
      } else {
        // Update the specific setting
        const updateQuery = `UPDATE settings SET ${key} = ? WHERE id = 1`;
        db.run(updateQuery, [value], function (err) {
          if (err) {
            console.error(`Error updating setting ${key}:`, err);
            reject(err);
          } else {
            resolve(true);
          }
        });
      }
    });
  });
}

// Add function to get user API key (with fallback to admin key)
async function getUserApiKey(chatId) {
  const user = await getUser(chatId);
  const requireApiKey = await getSetting("require_api_key", 0);

  // If user has a key, return it
  if (user && user.api_key) {
    return user.api_key;
  }

  // If global setting requires API key, return null
  if (requireApiKey === 1) {
    return null;
  }

  // Otherwise return the admin key from .env
  return process.env.GEMINI_API_KEY;
}

// Get all users waiting for approval
async function getPendingUsers() {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT * FROM users WHERE is_approved = 0 AND is_admin = 0",
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      }
    );
  });
}

// Get all admin users
async function getAdminUsers() {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM users WHERE is_admin = 1", (err, rows) => {
      if (err) {
        console.error("Error getting admin users:", err);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Get user by ID
async function getUserById(userId) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM users WHERE chat_id = ?", [userId], (err, row) => {
      if (err) {
        reject(err);
      } else {
        // Convert row to a more standardized format
        if (row) {
          resolve({
            id: row.id,
            chatId: row.chat_id,
            name: row.name,
            username: row.username,
            isAdmin: row.is_admin === 1,
            isApproved: row.is_approved === 1,
            requireApiKey: row.require_api_key === 1,
            schedule: row.schedule,
            lastQuestionDate: row.last_question_date,
          });
        } else {
          resolve(null);
        }
      }
    });
  });
}

module.exports = {
  getAllSentQuestions,
  saveQuestion,
  isQuestionUnique,
  deleteAllQuestions,
  getUser,
  createUser,
  updateUserSchedule,
  updateLastQuestionDate,
  getAllUsers,
  isAdmin,
  isApproved,
  approveUser,
  setUserApiKey,
  getUserApiKey,
  getSettings,
  updateSettings,
  setUserRequireApiKey,
  getPendingUsers,
  initDatabase,
  db: () => db,
  getSetting,
  updateSetting,
  getAdminUsers,
  getUserById,
};
