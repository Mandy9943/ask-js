const schedule = require("node-schedule");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

// Import our services
const db = require("./database");
const aiService = require("./ai-service");
const telegramService = require("./telegram-service");

// Ensure .env file exists
if (!fs.existsSync(path.resolve(__dirname, "../.env"))) {
  console.error(
    "Error: .env file not found. Please create one based on .env.example"
  );
  process.exit(1);
}

// Validate required environment variables
const requiredEnvVars = ["TELEGRAM_BOT_TOKEN", "GEMINI_API_KEY"];
const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error(
    `Error: Missing required environment variables: ${missingEnvVars.join(
      ", "
    )}`
  );
  process.exit(1);
}

// Store active scheduled jobs for each user
const userJobs = new Map();

// Add support for --check-only flag
const isCheckOnly = process.argv.includes("--check-only");

// Function to handle sending a new question
async function handleNewQuestion(chatId, category = null) {
  try {
    // Get the user
    const user = await db.getUser(chatId);
    if (!user) {
      console.error(`User not found: ${chatId}`);
      return false;
    }

    // Generate a question using AI
    let questionData;
    let isUnique = false;
    let attempts = 0;

    // Try to generate a unique question (max 3 attempts)
    while (!isUnique && attempts < 3) {
      questionData = await aiService.generateQuestion(category, chatId);
      isUnique = await db.isQuestionUnique(user.id, questionData.question);
      attempts++;
    }

    // Send the question to the user
    const sent = await telegramService.sendQuestion(
      chatId,
      questionData.question,
      questionData.answer,
      questionData.category
    );

    // Store the question in the database if successfully sent
    if (sent) {
      await db.saveQuestion(
        user.id,
        questionData.question,
        questionData.answer,
        questionData.category
      );
      // Update last question date
      await db.updateLastQuestionDate(chatId);
      console.log(
        `Question sent to ${chatId} and saved: ${questionData.question.substring(
          0,
          50
        )}...`
      );
    }

    return sent;
  } catch (error) {
    console.error("Error handling new question:", error);
    return false;
  }
}

// Function to reset database
async function resetDatabase(userId = null) {
  try {
    const count = await db.deleteAllQuestions(userId);
    return count;
  } catch (error) {
    console.error("Error resetting database:", error);
    throw error;
  }
}

// Function to create or update a user's scheduler with specified cron expression
function scheduleQuestionsForUser(chatId, cronExpression) {
  // Cancel existing job if it exists
  if (userJobs.has(chatId)) {
    userJobs.get(chatId).cancel();
    console.log(`Cancelled existing job for user ${chatId}`);
  }

  // Create new job with provided schedule
  const job = schedule.scheduleJob(cronExpression, async function () {
    console.log(
      `Running scheduled job for user ${chatId} at ${new Date().toLocaleString()}`
    );
    try {
      await handleNewQuestion(chatId);
    } catch (error) {
      console.error(`Error in scheduled job for user ${chatId}:`, error);
    }
  });

  if (job) {
    // Calculate and log next invocation time
    const nextInvocation = job.nextInvocation();
    console.log(
      `Next question for user ${chatId} scheduled for: ${
        nextInvocation ? nextInvocation.toLocaleString() : "Unknown"
      }`
    );

    // Store the job reference
    userJobs.set(chatId, job);
    console.log(
      `Scheduled questions for user ${chatId} with cron: ${cronExpression}`
    );
    return job;
  } else {
    console.error(
      `Failed to schedule job for user ${chatId} with cron expression: ${cronExpression}`
    );
    return null;
  }
}

// Initialize schedulers for all active users
async function initializeAllSchedulers() {
  try {
    const users = await db.getAllUsers(true);
    console.log(`Initializing schedulers for ${users.length} active users`);

    for (const user of users) {
      const schedule = user.schedule || "0 9 * * *";
      scheduleQuestionsForUser(user.chat_id, schedule);
    }
  } catch (error) {
    console.error("Error initializing schedulers:", error);
  }
}

// Main initialization function
async function init() {
  try {
    console.log("Initializing database...");
    await db.initDatabase();
    console.log("Database schema initialized and migrated if needed");

    if (isCheckOnly) {
      console.log("Check-only mode: database initialization successful");
      console.log("Exiting without starting bot");
      process.exit(0);
    }

    console.log("Initializing Telegram bot...");
    // Initialize the telegram bot with our handlers
    const bot = telegramService.initBot(
      handleNewQuestion,
      resetDatabase,
      scheduleQuestionsForUser
    );

    console.log("Setting up schedulers...");
    // Initialize scheduler for all users
    await initializeAllSchedulers();

    console.log("Application started successfully");
    console.log(`Telegram bot initialized`);
    console.log(`Database connected`);
  } catch (error) {
    console.error("Error during application initialization:", error);
    process.exit(1);
  }
}

// Handle application errors and shutdown
process.on("SIGINT", () => {
  console.log("Shutting down...");
  // Cancel all scheduled jobs
  for (const job of userJobs.values()) {
    job.cancel();
  }
  if (db.db()) {
    db.db().close();
  }
  process.exit(0);
});

// Start the application
init();
