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

// Create database connection
const dbPath = path.resolve(__dirname, "../data/questions.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error connecting to database:", err.message);
  } else {
    console.log("Connected to the questions database.");
    initDatabase();
  }
});

// Initialize database tables
function initDatabase() {
  // Create tables if they don't exist
  db.serialize(() => {
    // Table for storing sent questions
    db.run(`CREATE TABLE IF NOT EXISTS sent_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      category TEXT NOT NULL,
      sent_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
  });
}

// Get all sent questions
function getAllSentQuestions() {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM sent_questions", (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Save a new question
function saveQuestion(question, answer, category) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(
      "INSERT INTO sent_questions (question, answer, category) VALUES (?, ?, ?)"
    );
    stmt.run(question, answer, category, function (err) {
      if (err) {
        reject(err);
      } else {
        resolve(this.lastID);
      }
    });
    stmt.finalize();
  });
}

// Check if a question is too similar to previous ones
async function isQuestionUnique(question) {
  const sentQuestions = await getAllSentQuestions();
  // Simple check for now - just look for exact matches
  // Could be enhanced with more sophisticated similarity checking
  const isSimilar = sentQuestions.some(
    (q) => q.question.toLowerCase() === question.toLowerCase()
  );
  return !isSimilar;
}

// Delete all sent questions
function deleteAllQuestions() {
  return new Promise((resolve, reject) => {
    db.run("DELETE FROM sent_questions", function (err) {
      if (err) {
        reject(err);
      } else {
        console.log(`Deleted ${this.changes} questions from database`);
        resolve(this.changes);
      }
    });
  });
}

module.exports = {
  getAllSentQuestions,
  saveQuestion,
  isQuestionUnique,
  deleteAllQuestions,
  db,
};
