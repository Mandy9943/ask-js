const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Helper function to convert cron expression to readable time
function cronToReadableTime(cronExp) {
  try {
    const parts = cronExp.split(" ");
    if (parts.length >= 2) {
      const minutes = parts[0];
      const hours = parts[1];

      // Check if both are numeric and represent a valid time
      if (
        !isNaN(minutes) &&
        !isNaN(hours) &&
        parseInt(hours) >= 0 &&
        parseInt(hours) <= 23 &&
        parseInt(minutes) >= 0 &&
        parseInt(minutes) <= 59
      ) {
        // Format time with leading zeros
        const formattedHours = parseInt(hours).toString().padStart(2, "0");
        const formattedMinutes = parseInt(minutes).toString().padStart(2, "0");

        return `${formattedHours}:${formattedMinutes}`;
      }
    }
    return null; // Return null if can't parse
  } catch (e) {
    return null;
  }
}

// Initialize the bot with commands
function initBot(
  questionHandler,
  resetDbHandler,
  scheduleHandler,
  updateEnvHandler
) {
  // Set commands
  bot.setMyCommands([
    { command: "/start", description: "Start the bot" },
    {
      command: "/question",
      description: "Get a JavaScript interview question",
    },
    {
      command: "/reset",
      description: "Reset the question database (delete all)",
    },
    {
      command: "/schedule",
      description: "Change daily question time (format: HH:MM)",
    },
    { command: "/help", description: "Show help information" },
  ]);

  // Start command
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(
      chatId,
      `👋 Welcome to the JavaScript Interview Questions Bot!\n\n` +
        `I'll send you a new question every day to help you keep your JS, TS, and React knowledge fresh.\n\n` +
        `Use /question to get a question right now.\n` +
        `Use /help to see all available commands.`
    );
    // Store the chat ID for later use if not already set in .env
    console.log(`User started the bot. Chat ID: ${chatId}`);
  });

  // Help command
  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const currentCron = process.env.QUESTION_SCHEDULE || "0 9 * * *";
    const readableTime = cronToReadableTime(currentCron) || "09:00";

    bot.sendMessage(
      chatId,
      `📚 *JavaScript Interview Questions Bot Help*\n\n` +
        `*Commands:*\n` +
        `/start - Start the bot\n` +
        `/question [category] - Get a question (optional: javascript/js, typescript/ts, react)\n` +
        `/reset - Reset the question database (delete all questions)\n` +
        `/schedule HH:MM - Change the daily question time (e.g., /schedule 08:30)\n` +
        `/help - Show this help information\n\n` +
        `The bot will automatically send you a new question every day at ${readableTime}. Questions are generated using AI and cover JavaScript, TypeScript, and React topics.`,
      { parse_mode: "Markdown" }
    );
  });

  // Question command with optional category
  bot.onText(/\/question(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    try {
      // Check if a category was specified
      let category = match && match[1] ? match[1].trim().toLowerCase() : null;

      // Validate the category if provided
      const validCategories = ["javascript", "typescript", "react", "js", "ts"];
      if (category) {
        // Map shortened versions to full names
        if (category === "js") category = "javascript";
        if (category === "ts") category = "typescript";

        // Check if valid
        if (!validCategories.includes(category)) {
          return bot.sendMessage(
            chatId,
            `❌ Invalid category: "${category}"\n\nValid categories are: javascript (js), typescript (ts), react\n\nExample: /question javascript`
          );
        }
      }

      await sendLoadingIndicator(chatId);
      await questionHandler(chatId, category);
    } catch (error) {
      console.error("Error handling question command:", error);
      bot.sendMessage(
        chatId,
        "Sorry, I encountered an error when generating a question. Please try again later."
      );
    }
  });

  // Reset database command
  bot.onText(/\/reset/, async (msg) => {
    const chatId = msg.chat.id;

    // Confirm reset
    const confirm = await bot.sendMessage(
      chatId,
      "⚠️ Are you sure you want to delete all questions from the database? This cannot be undone.",
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Yes, reset database", callback_data: "reset_confirm" },
              { text: "Cancel", callback_data: "reset_cancel" },
            ],
          ],
        },
      }
    );

    // Handle confirmation button clicks
    bot.once("callback_query", async (callbackQuery) => {
      const action = callbackQuery.data;
      const chatId = callbackQuery.message.chat.id;

      if (action === "reset_confirm") {
        try {
          await sendLoadingIndicator(chatId);
          const deletedCount = await resetDbHandler();
          bot.sendMessage(
            chatId,
            `✅ Database reset successfully. Deleted ${deletedCount} questions.`
          );
        } catch (error) {
          console.error("Error resetting database:", error);
          bot.sendMessage(
            chatId,
            "❌ Failed to reset database. Please try again later."
          );
        }
      } else {
        bot.sendMessage(chatId, "❌ Database reset cancelled.");
      }

      // Remove confirmation buttons
      bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        {
          chat_id: chatId,
          message_id: confirm.message_id,
        }
      );
    });
  });

  // Schedule command
  bot.onText(/\/schedule(?:\s+(\d{1,2}):(\d{2}))?/, async (msg, match) => {
    const chatId = msg.chat.id;

    // If no time provided, show current schedule and instructions
    if (!match[1] || !match[2]) {
      const currentCron = process.env.QUESTION_SCHEDULE || "0 9 * * *";
      const readableTime = cronToReadableTime(currentCron) || "Unknown time";

      return bot.sendMessage(
        chatId,
        `ℹ️ Please provide a time in 24-hour format.\n` +
          `Example: /schedule 08:30 for 8:30 AM\n\n` +
          `Current schedule: ${readableTime} (daily)\n` +
          `Cron expression: ${currentCron}`
      );
    }

    // Parse hours and minutes
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);

    // Validate time format
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return bot.sendMessage(
        chatId,
        "❌ Invalid time format. Please use HH:MM in 24-hour format (00-23:00-59)."
      );
    }

    try {
      // Convert to cron expression
      const cronExpression = `${minutes} ${hours} * * *`;

      // Update scheduler
      scheduleHandler(cronExpression);

      // Update .env file
      updateEnvHandler(cronExpression);

      // Format time for display
      const formattedHours = hours.toString().padStart(2, "0");
      const formattedMinutes = minutes.toString().padStart(2, "0");

      bot.sendMessage(
        chatId,
        `✅ Schedule updated successfully!\n` +
          `Daily questions will now be sent at ${formattedHours}:${formattedMinutes}.`
      );
    } catch (error) {
      console.error("Error updating schedule:", error);
      bot.sendMessage(
        chatId,
        "❌ Failed to update schedule. Please try again later."
      );
    }
  });

  return bot;
}

// Send a "typing" indicator to show that a response is being generated
async function sendLoadingIndicator(chatId) {
  await bot.sendChatAction(chatId, "typing");
}

// Send a question and answer to the specified chat
async function sendQuestion(chatId, question, answer, category = "general") {
  try {
    // Format category name for display
    const formattedCategory =
      category.charAt(0).toUpperCase() + category.slice(1);

    // Send the question with category
    await bot.sendMessage(
      chatId,
      `*🧩 ${formattedCategory} Question:*\n\n${question}`,
      {
        parse_mode: "Markdown",
      }
    );

    // Wait a moment before sending the answer
    setTimeout(async () => {
      // Send the answer in a separate message
      await bot.sendMessage(chatId, `*🔍 Answer:*\n\n${answer}`, {
        parse_mode: "Markdown",
      });
    }, 1000);

    return true;
  } catch (error) {
    console.error("Error sending question:", error);
    return false;
  }
}

module.exports = {
  initBot,
  sendQuestion,
};
