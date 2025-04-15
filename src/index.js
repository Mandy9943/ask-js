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

// Global variable to store the current scheduled job
let currentJob = null;

// Function to handle sending a new question
async function handleNewQuestion(chatId, category = null) {
  try {
    // Generate a question using AI
    let questionData;
    let isUnique = false;
    let attempts = 0;

    // Try to generate a unique question (max 3 attempts)
    while (!isUnique && attempts < 3) {
      questionData = await aiService.generateQuestion(category);
      console.log("Question data:", questionData);
      isUnique = await db.isQuestionUnique(questionData.question);
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
        questionData.question,
        questionData.answer,
        questionData.category
      );
      console.log(
        `Question sent and saved: ${questionData.question.substring(0, 50)}...`
      );
    }

    return sent;
  } catch (error) {
    console.error("Error handling new question:", error);
    return false;
  }
}

// Function to reset database
async function resetDatabase() {
  try {
    const count = await db.deleteAllQuestions();
    return count;
  } catch (error) {
    console.error("Error resetting database:", error);
    throw error;
  }
}

// Function to create a new scheduler with specified cron expression
function scheduleQuestions(cronExpression) {
  // Cancel existing job if it exists
  if (currentJob) {
    currentJob.cancel();
  }

  // Create new job with provided schedule
  currentJob = schedule.scheduleJob(cronExpression, async () => {
    console.log("Running scheduled job to send daily question");

    // Use the chat ID from environment variable
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!chatId) {
      console.error("Error: TELEGRAM_CHAT_ID not set in .env file");
      return;
    }

    try {
      await handleNewQuestion(chatId);
    } catch (error) {
      console.error("Error in scheduled job:", error);
    }
  });

  console.log(`Scheduled to send questions at: ${cronExpression}`);
  return currentJob;
}

// Function to update schedule in the .env file
function updateScheduleInEnvFile(schedule) {
  try {
    const envPath = path.resolve(__dirname, "../.env");
    let envContent = fs.readFileSync(envPath, "utf8");

    // Replace existing schedule or add it if not present
    if (envContent.includes("QUESTION_SCHEDULE=")) {
      envContent = envContent.replace(
        /QUESTION_SCHEDULE=.*(\r?\n|$)/,
        `QUESTION_SCHEDULE="${schedule}"$1`
      );
    } else {
      envContent += `\nQUESTION_SCHEDULE="${schedule}"\n`;
    }

    fs.writeFileSync(envPath, envContent);
    return true;
  } catch (error) {
    console.error("Error updating .env file:", error);
    return false;
  }
}

// Initialize the telegram bot with our question handler
const bot = telegramService.initBot(
  handleNewQuestion,
  resetDatabase,
  scheduleQuestions,
  updateScheduleInEnvFile
);

// Schedule daily question
const scheduleRule = process.env.QUESTION_SCHEDULE || "0 9 * * *"; // Default to 9 AM daily
currentJob = scheduleQuestions(scheduleRule);

// Handle application errors and shutdown
process.on("SIGINT", () => {
  console.log("Shutting down...");
  if (currentJob) {
    currentJob.cancel();
  }
  db.db.close();
  process.exit(0);
});

// Test connection by logging some information
console.log("Application started successfully");
console.log(`Telegram bot initialized`);
console.log(`Database connected`);
