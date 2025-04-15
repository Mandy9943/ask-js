const TelegramBot = require("node-telegram-bot-api");
const db = require("./database");
const { GoogleGenAI } = require("@google/genai");
const aiService = require("./ai-service");
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

// Register or update user in database
async function registerUser(chatId, firstName, lastName) {
  const user = await db.getUser(chatId);

  if (user) {
    return user;
  }

  // For new users, check if approval is required
  const requireApproval = await db.getSetting("require_user_approval", 0);
  const isApproved = requireApproval == 0 ? 1 : 0; // Auto-approve if setting is off

  // Get admin user(s) to notify about new registrations
  const adminUsers = await db.getAdminUsers();
  const isAdmin = chatId.toString() === process.env.TELEGRAM_CHAT_ID;

  // Always approve admin users
  const finalApprovalStatus = isAdmin ? 1 : isApproved;

  await db.createUser(chatId, firstName, lastName, finalApprovalStatus);
  console.log(
    `User registered: ${chatId} (${firstName} ${lastName}), approved: ${finalApprovalStatus}`
  );

  // Notify admins about new user if approval is required
  if (requireApproval == 1 && !isAdmin) {
    for (const admin of adminUsers) {
      await bot.sendMessage(
        admin.chat_id,
        `New user registered:\nID: ${chatId}\nName: ${firstName} ${
          lastName || ""
        }\n\nUse /approve ${chatId} to approve this user.`
      );
    }
  }

  return await db.getUser(chatId);
}

// Check if a user can use the bot (is approved)
async function canUseBot(userId) {
  const requireApproval = await db.getSetting("require_user_approval", 0);

  // If approval is not required, all users can use the bot
  if (requireApproval == 0) {
    return true;
  }

  // Admin users are always approved
  if (userId.toString() === process.env.TELEGRAM_CHAT_ID) {
    return true;
  }

  // Check if this specific user is approved
  const user = await db.getUser(userId);
  return user && user.is_approved == 1;
}

// Check if a user can generate questions (has API key if required)
async function canGenerateQuestions(userId) {
  // Check if API key is required globally
  const requireApiKey = await db.getSetting("require_api_key", 0);

  // If API key is required and user doesn't have one, they can't generate questions
  if (requireApiKey == 1) {
    const apiKey = await db.getUserApiKey(userId);
    return !!apiKey; // Return true if API key exists
  }

  // If not required globally, user can generate questions
  return true;
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
    { command: "/help", description: "Show help information" },
    {
      command: "/question",
      description: "Get a JavaScript interview question",
    },
    {
      command: "/q",
      description: "Quick shorthand for a random question",
    },
    {
      command: "/reset",
      description: "Reset your question history",
    },
    {
      command: "/schedule",
      description: "Change daily question time (format: HH:MM)",
    },
    { command: "/setapikey", description: "Set your Gemini API key" },
    { command: "/stats", description: "Show your statistics" },
  ]);

  // Start command handler
  bot.onText(/\/start/, async (msg) => {
    try {
      const chatId = msg.chat.id;
      const firstName = msg.from.first_name;
      const isAdmin = chatId.toString() === process.env.TELEGRAM_CHAT_ID;

      // Register the user
      await registerUser(chatId, firstName, msg.from.last_name);

      // Check if user is approved
      const user = await db.getUserById(chatId);
      const isApproved = isAdmin || (user && user.isApproved);

      // Welcome message
      let welcomeMessage = `👋 Welcome, ${firstName}! I'm your JavaScript Interview Questions Bot.\n\n`;

      if (!isApproved && !isAdmin) {
        welcomeMessage += `⚠️ Your account is pending approval by an administrator. You'll be notified when approved.\n\n`;
      }

      bot.sendMessage(chatId, welcomeMessage);

      // Show help message with all commands
      await handleHelp(msg);

      // Notify admins about new user if not approved
      if (!isApproved && !isAdmin) {
        notifyAdminsAboutNewUser(chatId, firstName, msg.from.last_name);
      }
    } catch (error) {
      console.error("Error in start command:", error);
    }
  });

  // Help command
  bot.onText(/\/help/, handleHelp);

  // Question command handler
  bot.onText(/\/question(?:\s+(.+))?/, async (msg, match) => {
    try {
      const chatId = msg.chat.id;
      const firstName = msg.from.first_name;
      const isAdmin = chatId.toString() === process.env.TELEGRAM_CHAT_ID;

      // Register user if not already registered
      await registerUser(chatId, firstName, msg.from.last_name);

      // Check if user is approved (admins are always approved)
      if (!isAdmin) {
        const user = await db.getUserById(chatId);
        if (user && !user.isApproved) {
          bot.sendMessage(
            chatId,
            "⚠️ Your account is pending approval by an administrator. You'll be notified when you can use the bot."
          );
          return;
        }
      }

      // Get category from message or use default
      const category = match[1] ? match[1].toLowerCase().trim() : "javascript";

      // Send typing action to show the bot is processing
      bot.sendChatAction(chatId, "typing");

      // Generate the question
      const loadingMessage = await bot.sendMessage(
        chatId,
        "Generating your question..."
      );

      try {
        const response = await aiService.generateQuestion(category, chatId);

        if (!response) {
          await bot.editMessageText(
            "Sorry, I couldn't generate a question. Please try again later.",
            {
              chat_id: chatId,
              message_id: loadingMessage.message_id,
            }
          );
          return;
        }

        // Send the question
        await bot.editMessageText(
          `*${response.question}*\n\n${
            response.options ? response.options.join("\n") : ""
          }`,
          {
            chat_id: chatId,
            message_id: loadingMessage.message_id,
            parse_mode: "Markdown",
          }
        );

        // Wait a bit before sending the answer
        setTimeout(async () => {
          await bot.sendMessage(chatId, `*Answer:*\n${response.answer}`, {
            parse_mode: "Markdown",
          });
        }, 500);
      } catch (error) {
        console.error("Error generating question:", error);
        await bot.editMessageText(
          "Sorry, there was an error generating your question. Please try again.",
          {
            chat_id: chatId,
            message_id: loadingMessage.message_id,
          }
        );
      }
    } catch (error) {
      console.error("Error in question command:", error);
    }
  });

  // Reset database command
  bot.onText(/\/reset/, async (msg) => {
    const chatId = msg.chat.id;

    // Register user
    await registerUser(chatId, msg.from.first_name, msg.from.last_name);
    const user = await db.getUser(chatId.toString());
    if (!user) {
      return bot.sendMessage(chatId, "Please start the bot first with /start");
    }

    // Check if user is admin for special options
    const isAdmin = await db.isAdmin(chatId.toString());
    let options = [
      [
        { text: "Yes, reset my history", callback_data: "reset_confirm_user" },
        { text: "Cancel", callback_data: "reset_cancel" },
      ],
    ];

    // Add admin option
    if (isAdmin) {
      options.push([
        {
          text: "⚠️ Reset ALL users' history",
          callback_data: "reset_confirm_all",
        },
      ]);
    }

    // Confirm reset
    const confirm = await bot.sendMessage(
      chatId,
      "⚠️ Are you sure you want to delete your question history? This cannot be undone.",
      {
        reply_markup: {
          inline_keyboard: options,
        },
      }
    );

    // Handle confirmation button clicks
    bot.once("callback_query", async (callbackQuery) => {
      const action = callbackQuery.data;
      const chatId = callbackQuery.message.chat.id;

      if (action === "reset_confirm_user") {
        try {
          await sendLoadingIndicator(chatId);
          const deletedCount = await resetDbHandler(user.id);
          bot.sendMessage(
            chatId,
            `✅ Your question history has been reset. Deleted ${deletedCount} questions.`
          );
        } catch (error) {
          console.error("Error resetting database:", error);
          bot.sendMessage(
            chatId,
            "❌ Failed to reset your history. Please try again later."
          );
        }
      } else if (action === "reset_confirm_all" && isAdmin) {
        try {
          await sendLoadingIndicator(chatId);
          const deletedCount = await resetDbHandler();
          bot.sendMessage(
            chatId,
            `✅ All question history has been reset. Deleted ${deletedCount} questions from all users.`
          );
        } catch (error) {
          console.error("Error resetting database for all users:", error);
          bot.sendMessage(
            chatId,
            "❌ Failed to reset all history. Please try again later."
          );
        }
      } else {
        bot.sendMessage(chatId, "❌ Reset cancelled.");
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

    // Register user
    await registerUser(chatId, msg.from.first_name, msg.from.last_name);
    const user = await db.getUser(chatId.toString());
    if (!user) {
      return bot.sendMessage(chatId, "Please start the bot first with /start");
    }

    // If no time provided, show current schedule and instructions
    if (!match[1] || !match[2]) {
      const currentCron = user.schedule || "0 9 * * *";
      const readableTime = cronToReadableTime(currentCron) || "Unknown time";

      return bot.sendMessage(
        chatId,
        `ℹ️ Please provide a time in 24-hour format.\n` +
          `Example: /schedule 08:30 for 8:30 AM\n\n` +
          `Your current schedule: ${readableTime} (daily)\n` +
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

      // Update user's schedule in database
      await db.updateUserSchedule(chatId.toString(), cronExpression);

      // Update scheduler for this user
      scheduleHandler(chatId.toString(), cronExpression);

      // Format time for display
      const formattedHours = hours.toString().padStart(2, "0");
      const formattedMinutes = minutes.toString().padStart(2, "0");

      bot.sendMessage(
        chatId,
        `✅ Your schedule updated successfully!\n` +
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

  // Stats command
  bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;

    // Register user
    await registerUser(chatId, msg.from.first_name, msg.from.last_name);
    const user = await db.getUser(chatId.toString());
    if (!user) {
      return bot.sendMessage(chatId, "Please start the bot first with /start");
    }

    try {
      // Get stats for this user
      const questions = await db.getAllSentQuestions(user.id);

      // Count by category
      const categoryCounts = {};
      questions.forEach((q) => {
        categoryCounts[q.category] = (categoryCounts[q.category] || 0) + 1;
      });

      // Format category stats
      let categoryStats = "";
      for (const [category, count] of Object.entries(categoryCounts)) {
        categoryStats += `\n- ${
          category.charAt(0).toUpperCase() + category.slice(1)
        }: ${count}`;
      }

      // Last question date
      const lastDate = user.last_question_date
        ? new Date(user.last_question_date).toLocaleString()
        : "Never";

      bot.sendMessage(
        chatId,
        `📊 *Your Question Statistics*\n\n` +
          `Total questions received: ${questions.length}\n` +
          `Categories:${categoryStats || "\n- None yet"}\n\n` +
          `Last question: ${lastDate}\n` +
          `Daily questions scheduled for: ${
            cronToReadableTime(user.schedule) || "09:00"
          }`,
        { parse_mode: "Markdown" }
      );
    } catch (error) {
      console.error("Error getting user stats:", error);
      bot.sendMessage(
        chatId,
        "❌ Failed to retrieve your statistics. Please try again later."
      );
    }
  });

  // Admin-only: users command
  bot.onText(/\/users/, async (msg) => {
    const chatId = msg.chat.id;

    // Check if user is admin
    const isAdmin = await db.isAdmin(chatId.toString());
    if (!isAdmin) {
      return bot.sendMessage(
        chatId,
        "⛔ This command is only available to admins."
      );
    }

    try {
      // Get all users
      const users = await db.getAllUsers(false);

      if (users.length === 0) {
        return bot.sendMessage(chatId, "No users found in the database.");
      }

      // Format user list
      let message = `👥 *User List (${users.length} total)*\n\n`;

      for (const user of users) {
        const status = user.is_active === 1 ? "Active" : "Inactive";
        const admin = user.is_admin === 1 ? "👑 " : "";
        const name = user.name || "Unknown";
        const username = user.username ? `@${user.username}` : "";

        message += `${admin}${name} ${username}\n`;
        message += `ID: ${user.chat_id}\n`;
        message += `Status: ${status}\n`;
        message += `Schedule: ${
          cronToReadableTime(user.schedule) || "Default"
        }\n\n`;
      }

      bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error) {
      console.error("Error listing users:", error);
      bot.sendMessage(
        chatId,
        "❌ Failed to retrieve user list. Please try again later."
      );
    }
  });

  // Admin-only: broadcast command
  bot.onText(/\/broadcast(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;

    // Check if user is admin
    const isAdmin = await db.isAdmin(chatId.toString());
    if (!isAdmin) {
      return bot.sendMessage(
        chatId,
        "⛔ This command is only available to admins."
      );
    }

    // Check if message was provided
    const broadcastMessage = match && match[1] ? match[1].trim() : null;
    if (!broadcastMessage) {
      return bot.sendMessage(
        chatId,
        "Please provide a message to broadcast: `/broadcast Your message here`",
        { parse_mode: "Markdown" }
      );
    }

    try {
      // Get all active users
      const users = await db.getAllUsers(true);

      if (users.length === 0) {
        return bot.sendMessage(
          chatId,
          "No active users found to broadcast to."
        );
      }

      // Send confirmation
      const confirm = await bot.sendMessage(
        chatId,
        `Are you sure you want to send this broadcast to ${users.length} users?\n\n` +
          `Message:\n${broadcastMessage}`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "Yes, send broadcast",
                  callback_data: "broadcast_confirm",
                },
                { text: "Cancel", callback_data: "broadcast_cancel" },
              ],
            ],
          },
        }
      );

      // Handle confirmation
      bot.once("callback_query", async (callbackQuery) => {
        const action = callbackQuery.data;

        if (action === "broadcast_confirm") {
          let successCount = 0;
          let failCount = 0;

          // Send status message
          const statusMsg = await bot.sendMessage(
            chatId,
            "📡 Broadcasting message... 0%"
          );

          // Send to each user
          for (let i = 0; i < users.length; i++) {
            try {
              await bot.sendMessage(
                users[i].chat_id,
                `📢 *Broadcast from Admin*\n\n${broadcastMessage}`,
                { parse_mode: "Markdown" }
              );
              successCount++;

              // Update status every 5 users or at the end
              if (i % 5 === 0 || i === users.length - 1) {
                const percent = Math.round(((i + 1) / users.length) * 100);
                await bot.editMessageText(
                  `📡 Broadcasting message... ${percent}%`,
                  {
                    chat_id: chatId,
                    message_id: statusMsg.message_id,
                  }
                );
              }
            } catch (err) {
              console.error(
                `Failed to send broadcast to ${users[i].chat_id}:`,
                err.message
              );
              failCount++;
            }
          }

          // Final report
          bot.sendMessage(
            chatId,
            `✅ Broadcast complete!\n\n` +
              `Successfully sent to: ${successCount} users\n` +
              `Failed: ${failCount} users`
          );
        } else {
          bot.sendMessage(chatId, "❌ Broadcast cancelled.");
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
    } catch (error) {
      console.error("Error broadcasting message:", error);
      bot.sendMessage(
        chatId,
        "❌ Failed to broadcast message. Please try again later."
      );
    }
  });

  // Admin-only: overall stats
  bot.onText(/\/stats_all/, async (msg) => {
    const chatId = msg.chat.id;

    // Check if user is admin
    const isAdmin = await db.isAdmin(chatId.toString());
    if (!isAdmin) {
      return bot.sendMessage(
        chatId,
        "⛔ This command is only available to admins."
      );
    }

    try {
      // Get users
      const users = await db.getAllUsers(false);
      const activeUsers = users.filter((u) => u.is_active === 1).length;

      // Query total questions
      const totalQuestions = await new Promise((resolve, reject) => {
        db.db().get(
          "SELECT COUNT(*) as count FROM sent_questions",
          (err, row) => {
            if (err) reject(err);
            else resolve(row?.count || 0);
          }
        );
      });

      // Query by category
      const categoryCounts = await new Promise((resolve, reject) => {
        db.db().all(
          "SELECT category, COUNT(*) as count FROM sent_questions GROUP BY category",
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      // Format category stats
      let categoryStats = "";
      for (const row of categoryCounts) {
        categoryStats += `\n- ${
          row.category.charAt(0).toUpperCase() + row.category.slice(1)
        }: ${row.count}`;
      }

      bot.sendMessage(
        chatId,
        `📊 *Overall Bot Statistics*\n\n` +
          `Total users: ${users.length}\n` +
          `Active users: ${activeUsers}\n\n` +
          `Total questions sent: ${totalQuestions}\n` +
          `Categories:${categoryStats || "\n- None yet"}`,
        { parse_mode: "Markdown" }
      );
    } catch (error) {
      console.error("Error getting overall stats:", error);
      bot.sendMessage(
        chatId,
        "❌ Failed to retrieve statistics. Please try again later."
      );
    }
  });

  // Admin command to approve users
  bot.onText(/\/approve (.+)/, async (msg, match) => {
    try {
      const adminChatId = msg.chat.id;

      // Check if user is admin
      const isAdmin = await db.isAdmin(adminChatId.toString());
      if (!isAdmin) {
        await bot.sendMessage(adminChatId, "Only admins can use this command.");
        return;
      }

      const userChatId = match[1];
      await db.approveUser(userChatId);

      await bot.sendMessage(
        adminChatId,
        `User ${userChatId} has been approved.`
      );

      // Notify the user that they've been approved
      try {
        await bot.sendMessage(
          userChatId,
          "Your account has been approved! You can now use the bot."
        );
      } catch (error) {
        console.error("Could not notify user about approval:", error);
      }
    } catch (error) {
      console.error("Error in /approve command:", error);
    }
  });

  // Admin command to list pending users
  bot.onText(/\/pending/, async (msg) => {
    try {
      const adminChatId = msg.chat.id;

      // Check if user is admin
      const isAdmin = await db.isAdmin(adminChatId.toString());
      if (!isAdmin) {
        await bot.sendMessage(adminChatId, "Only admins can use this command.");
        return;
      }

      const pendingUsers = await db.getPendingUsers();

      if (pendingUsers.length === 0) {
        await bot.sendMessage(adminChatId, "No pending users.");
        return;
      }

      let message = "Pending users:\n";
      for (const user of pendingUsers) {
        message += `ID: ${user.chat_id}, Name: ${user.first_name} ${
          user.last_name || ""
        }\n`;
      }

      await bot.sendMessage(adminChatId, message);
    } catch (error) {
      console.error("Error in /pending command:", error);
    }
  });

  // Admin command to manage settings
  bot.onText(/\/settings/, async (msg) => {
    try {
      const adminChatId = msg.chat.id;

      // Check if user is admin
      const isAdmin = await db.isAdmin(adminChatId.toString());
      if (!isAdmin) {
        await bot.sendMessage(adminChatId, "Only admins can use this command.");
        return;
      }

      const requireApproval = await db.getSetting("require_user_approval", 0);
      const requireApiKey = await db.getSetting("require_api_key", 0);

      const message = `Bot settings:
      
Require user approval: ${requireApproval == 1 ? "ON" : "OFF"}
Require API key: ${requireApiKey == 1 ? "ON" : "OFF"}

Commands:
/toggleapproval - Toggle user approval requirement
/toggleapikey - Toggle API key requirement`;

      await bot.sendMessage(adminChatId, message);
    } catch (error) {
      console.error("Error in /settings command:", error);
    }
  });

  // Admin command to toggle user approval requirement
  bot.onText(/\/toggleapproval/, async (msg) => {
    try {
      const adminChatId = msg.chat.id;

      // Check if user is admin
      const isAdmin = await db.isAdmin(adminChatId.toString());
      if (!isAdmin) {
        await bot.sendMessage(adminChatId, "Only admins can use this command.");
        return;
      }

      const currentValue = await db.getSetting("require_user_approval", 0);
      const newValue = currentValue == 1 ? 0 : 1;

      await db.updateSetting("require_user_approval", newValue);

      await bot.sendMessage(
        adminChatId,
        `User approval requirement is now ${newValue == 1 ? "ON" : "OFF"}.`
      );
    } catch (error) {
      console.error("Error in /toggleapproval command:", error);
    }
  });

  // Admin command to toggle API key requirement
  bot.onText(/\/toggleapikey/, async (msg) => {
    try {
      const adminChatId = msg.chat.id;

      // Check if user is admin
      const isAdmin = await db.isAdmin(adminChatId.toString());
      if (!isAdmin) {
        await bot.sendMessage(adminChatId, "Only admins can use this command.");
        return;
      }

      const currentValue = await db.getSetting("require_api_key", 0);
      const newValue = currentValue == 1 ? 0 : 1;

      await db.updateSetting("require_api_key", newValue);

      await bot.sendMessage(
        adminChatId,
        `API key requirement is now ${newValue == 1 ? "ON" : "OFF"}.`
      );
    } catch (error) {
      console.error("Error in /toggleapikey command:", error);
    }
  });

  // API key setting command
  bot.onText(/\/setapikey(?:\s+(.+))?/, async (msg, match) => {
    try {
      const chatId = msg.chat.id;

      // Register user if not already registered
      await registerUser(chatId, msg.from.first_name, msg.from.last_name);

      // Get the API key from the command
      const apiKey = match && match[1] ? match[1].trim() : null;

      // If no API key provided, show instructions
      if (!apiKey) {
        return bot.sendMessage(
          chatId,
          `To set your Google Gemini API key, use the command:\n/setapikey YOUR_API_KEY\n\nYou can get an API key from https://aistudio.google.com/app/apikey`
        );
      }

      // Validate API key format (basic check)
      if (!apiKey.startsWith("AI") || apiKey.length < 20) {
        return bot.sendMessage(
          chatId,
          "❌ Invalid API key format. Gemini API keys typically start with 'AI' and are longer than 20 characters."
        );
      }

      // Test the API key by creating a temp client
      try {
        const genAI = new GoogleGenAI({ apiKey });

        // Simple test prompt
        const result = await genAI.models.generateContent({
          model: "gemini-pro",
          contents: "Say 'API key is valid'",
        });
        const text = result.text;

        if (!text || !text.includes("valid")) {
          throw new Error("API key validation failed");
        }

        // If we get here, the API key is valid, so save it
        await db.setUserApiKey(chatId, apiKey);

        bot.sendMessage(
          chatId,
          "✅ Your API key has been successfully validated and saved."
        );
      } catch (error) {
        console.error("API key validation error:", error);
        bot.sendMessage(
          chatId,
          "❌ The API key you provided seems to be invalid. Please check the key and try again."
        );
      }
    } catch (error) {
      console.error("Error in /setapikey command:", error);
      bot.sendMessage(
        chatId,
        "Sorry, I encountered an error while processing your API key. Please try again later."
      );
    }
  });

  // Question command handler - sends a random question from a random category
  bot.onText(/^\/q$/, async (msg) => {
    try {
      const chatId = msg.chat.id;

      // Ensure user is registered and approved if required
      await registerUser(chatId, msg.from.first_name, msg.from.last_name);

      if (!(await canUseBot(chatId))) {
        await bot.sendMessage(
          chatId,
          "Your account is pending approval. Please wait for an admin to approve you."
        );
        return;
      }

      // Check if user can generate questions (has API key if required)
      if (!(await canGenerateQuestions(chatId))) {
        await bot.sendMessage(
          chatId,
          "You need to set your Google Gemini API key to use this bot. Use /setapikey [your_key] to set it."
        );
        return;
      }

      // Send "generating" message
      const loadingMessage = await bot.sendMessage(
        chatId,
        "Generating a random question... ⏳"
      );

      try {
        // Generate a question
        const result = await aiService.generateQuestion(null, chatId);
        // Store the question and its answer
        await db.saveQuestion(
          chatId,
          result.question,
          result.answer,
          result.category
        );

        // Edit the loading message with the actual question
        await bot.editMessageText(result.question, {
          chat_id: chatId,
          message_id: loadingMessage.message_id,
        });
      } catch (error) {
        // Handle API key errors specifically
        if (error.message && error.message.includes("API key")) {
          await bot.editMessageText(
            `Error: ${error.message}. Please use /setapikey to set a valid API key.`,
            {
              chat_id: chatId,
              message_id: loadingMessage.message_id,
            }
          );
        } else {
          // Handle other errors
          console.error("Error generating question:", error);
          await bot.editMessageText(
            "Sorry, I couldn't generate a question. Please try again later.",
            {
              chat_id: chatId,
              message_id: loadingMessage.message_id,
            }
          );
        }
      }
    } catch (error) {
      console.error("Error in /q command:", error);
    }
  });

  // Security commands
  bot.onText(/\/security/, handleSecurityCommand);
  bot.onText(/\/api_key_required/, toggleApiKeyRequired);
  bot.onText(/\/approval_required/, toggleApprovalRequired);

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

// Helper function to notify admins about new users
async function notifyAdminsAboutNewUser(userId, firstName, lastName) {
  try {
    // Get all admin users
    const admins = await db.getAdmins();

    if (!admins || admins.length === 0) {
      console.log("No admins found to notify about new user");
      return;
    }

    const userFullName = lastName ? `${firstName} ${lastName}` : firstName;
  } catch (error) {
    console.error("Error notifying admins about new user:", error);
  }
}

// Add new function to handle security settings
async function handleSecurityCommand(msg) {
  const chatId = msg.chat.id;
  const user = await db.getUserById(chatId);

  if (!user || !user.isAdmin) {
    return bot.sendMessage(chatId, "This command is only available to admins.");
  }

  const requireApiKey = await db.getSetting("require_api_key", 0);
  const requireApproval = await db.getSetting("require_user_approval", 0);

  const message = `*Security Settings*:
- API Key Required: ${requireApiKey === 1 ? "✅ Yes" : "❌ No"}
- User Approval Required: ${requireApproval === 1 ? "✅ Yes" : "❌ No"}

You can toggle these settings with:
/api_key_required - Toggle API key requirement
/approval_required - Toggle user approval requirement`;

  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
}

async function toggleApiKeyRequired(msg) {
  const chatId = msg.chat.id;
  const user = await db.getUserById(chatId);

  if (!user || !user.isAdmin) {
    return bot.sendMessage(chatId, "This command is only available to admins.");
  }

  const currentSetting = await db.getSetting("require_api_key", 0);
  const newSetting = currentSetting === 1 ? 0 : 1;

  await db.updateSetting("require_api_key", newSetting);

  bot.sendMessage(
    chatId,
    `API key requirement has been ${
      newSetting === 1 ? "enabled" : "disabled"
    }.${
      newSetting === 1
        ? " All users will now need to provide their own API key."
        : " Users can now use the bot without providing their own API key."
    }`
  );
}

async function toggleApprovalRequired(msg) {
  const chatId = msg.chat.id;
  const user = await db.getUserById(chatId);

  if (!user || !user.isAdmin) {
    return bot.sendMessage(chatId, "This command is only available to admins.");
  }

  const currentSetting = await db.getSetting("require_user_approval", 0);
  const newSetting = currentSetting === 1 ? 0 : 1;

  await db.updateSetting("require_user_approval", newSetting);

  bot.sendMessage(
    chatId,
    `User approval requirement has been ${
      newSetting === 1 ? "enabled" : "disabled"
    }.${
      newSetting === 1
        ? " New users will need to be approved before using the bot."
        : " New users can use the bot without approval."
    }`
  );
}

async function handleQuestion(msg) {
  const chatId = msg.chat.id;
  const question = msg.text.replace("/question", "").trim();

  // Check if user exists and is approved
  const user = await db.getUser(chatId);
  const requireApproval = await db.getSetting("require_user_approval", 0);

  if (!user) {
    return bot.sendMessage(
      chatId,
      "You need to register first. Use /start to register."
    );
  }

  if (requireApproval === 1 && user.is_approved !== 1) {
    return bot.sendMessage(
      chatId,
      "Your account is pending approval. Please wait for an admin to approve your account."
    );
  }

  // Check if user has API key if required
  const apiKey = await db.getUserApiKey(chatId);
  const requireApiKey = await db.getSetting("require_api_key", 0);

  if (requireApiKey === 1 && !apiKey) {
    return bot.sendMessage(
      chatId,
      "You need to set your Google Gemini API key before using the bot. Please use /setapikey command followed by your API key."
    );
  }

  try {
    bot.sendChatAction(chatId, "typing");

    let finalQuestion = question;
    let result;

    if (!finalQuestion) {
      // Generate a random question
      result = await aiService.generateQuestion(null, chatId);
      finalQuestion = result.question;
    } else {
      // User provided their own question
      const genAI = new GoogleGenAI({ apiKey });
      const response = await genAI.models.generateContent({
        model: "gemini-pro",
        contents: finalQuestion,
      });
      const text = response.text;

      result = {
        question: finalQuestion,
        answer: text,
      };
    }

    await bot.sendMessage(
      chatId,
      result.answer || "Sorry, I couldn't generate a response."
    );

    // Save the question in the database
    if (finalQuestion) {
      await db.saveQuestion(
        chatId,
        finalQuestion,
        result.answer || "No answer generated"
      );
    }
  } catch (error) {
    console.error("Error handling question:", error);
    bot.sendMessage(chatId, `Error generating response: ${error.message}`);
  }
}

async function handleHelp(msg) {
  const chatId = msg.chat.id;
  const user = await db.getUserById(chatId);
  const isAdmin = chatId.toString() === process.env.TELEGRAM_CHAT_ID;
  const isApproved = isAdmin || (user && user.isApproved);

  let helpMessage = `🤖 JavaScript Interview Questions Bot - Help\n\n`;

  if (!isApproved && !isAdmin) {
    helpMessage += `⚠️ Your account is pending approval by an administrator. You'll be notified when approved.\n\n`;
  }

  helpMessage += `
*Available Commands*:
/start - Register with the bot
/help - Show this help message
/question - Generate a random question
/q - Quick shorthand for generating a random question
/question [category] - Get a specific category question (javascript, typescript, react)
/reset - Reset your question history
/schedule [HH:MM] - Set up daily question schedule
/stats - View your question statistics
/setapikey - Set your Google Gemini API key
  `;

  // Add admin commands if the user is an admin
  if (user && user.isAdmin) {
    helpMessage += `
*Admin Commands*:
/users - List all registered users
/pending - View users waiting for approval
/approve [user_id] - Approve a pending user
/broadcast [message] - Send a message to all users
/stats_all - View overall statistics
/security - View security settings
/settings - View and manage bot settings
/api_key_required - Toggle API key requirement
/approval_required - Toggle user approval requirement
/toggleapikey - Toggle API key requirement (alias)
/toggleapproval - Toggle approval requirement (alias)
    `;
  }

  // Add API key information
  const userApiKey = await db.getUserApiKey(chatId);
  if (!userApiKey) {
    helpMessage += `\nℹ️ For the best experience, please set your own Google Gemini API key using the /setapikey command. Without your own API key, question generation may be limited.`;
  } else {
    helpMessage += `\n✅ You have set your personal API key.`;
  }

  bot.sendMessage(chatId, helpMessage, { parse_mode: "Markdown" });
}

// Helper function to generate a random question
async function generateRandomQuestion() {
  // Use the aiService to generate a random question
  const result = await aiService.generateQuestion();
  return result.question;
}

module.exports = {
  initBot,
  sendQuestion,
};
