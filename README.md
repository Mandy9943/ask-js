# Daily JavaScript Interview Questions Bot

A Telegram bot that sends daily JavaScript, TypeScript, and React interview questions to help you keep your programming knowledge fresh.

## Features

- Daily interview questions for mid and senior-level JavaScript, TypeScript, and React developers
- Filter questions by programming language/framework
- Multi-user support with personalized settings for each user
- AI-generated questions and answers using Gemini API
- Delivered directly to your Telegram
- User-specific question history to avoid repetition
- No paid services required (apart from Gemini API, which has a free tier)
- Customizable per-user schedule for daily questions
- Admin features for managing users and broadcasting messages

## Setup

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a Telegram bot:
   - Talk to [BotFather](https://t.me/botfather) on Telegram
   - Use /newbot command and follow instructions
   - Copy your bot token
   
4. Get your Telegram Chat ID for admin access:
   - Message [@userinfobot](https://t.me/userinfobot) on Telegram
   - Copy your ID
   - Alternatively, start the bot and check the console logs for your Chat ID
   
5. Set up a Gemini API key:
   - Visit [Google AI Studio](https://ai.google.dev/)
   - Create an account and get an API key

6. Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```
   
7. Edit the `.env` file with your keys:
   ```
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   TELEGRAM_CHAT_ID=your_telegram_chat_id_for_admin_access
   GEMINI_API_KEY=your_gemini_api_key
   ```

## Usage

Start the bot:

```bash
npm start
```

Users can start using the bot by sending `/start` to your bot on Telegram.

Each user will:
- Receive a new question every day at their chosen time (default: 9 AM)
- Have their own question history to avoid repeated questions
- Be able to customize their preferred schedule

## Commands

### User Commands
- `/start` - Start the bot
- `/help` - Show help information
- `/question` - Generate a random question
- `/q` - Quick shorthand for generating a random question
- `/question [category]` - Get a question from a specific category (javascript/js, typescript/ts, or react)
- `/reset` - Reset your personal question history
- `/schedule HH:MM` - Change your daily question time (e.g., /schedule 08:30)
- `/stats` - View your question statistics
- `/setapikey [key]` - Set your Google Gemini API key

### Admin Commands
- `/users` - List all registered users
- `/pending` - View users waiting for approval
- `/approve [user_id]` - Approve a pending user
- `/broadcast [message] - Send a message to all users
- `/stats_all` - View overall usage statistics
- `/security` - View security settings
- `/settings` - View and manage bot settings
- `/api_key_required` - Toggle API key requirement
- `/approval_required` - Toggle user approval requirement
- `/toggleapikey` - Toggle API key requirement (alias)
- `/toggleapproval` - Toggle approval requirement (alias)

## Multi-User System

The bot features a complete multi-user system:

1. **Per-User Settings**: Each user has their own:
   - Schedule for receiving daily questions
   - Question history to prevent repetition
   - Statistics tracking

2. **Admin User**: The user specified in TELEGRAM_CHAT_ID becomes the admin with access to:
   - User management features
   - Broadcasting messages to all users
   - Global statistics
   - Global reset capabilities

3. **User Registration**: Users are automatically registered when they first interact with the bot.

## Customization

### User-Specific API Keys

Each user can now set their own Gemini API key if they want to:

1. Get your own API key from [Google AI Studio](https://ai.google.dev/)
2. Use the `/setapikey YOUR_API_KEY` command in Telegram
3. The bot will validate and save your key securely
4. All questions generated for you will use your personal API key
5. You can remove your API key with `/deleteapikey`
6. See detailed documentation in [docs/API_KEYS.md](docs/API_KEYS.md)

### Filtering Questions by Category

You can filter questions by technology:

- `/question javascript` or `/question js` - Get a JavaScript question
- `/question typescript` or `/question ts` - Get a TypeScript question
- `/question react` - Get a React question
- `/question` - Get a random question from any category

### Per-User Schedule

Each user can set their own preferred time for daily questions:

1. Using the Telegram bot command:
   ```
   /schedule 08:30
   ```
   This sets the bot to send questions at 8:30 AM every day for that specific user.

### Question History Management

If a user wants to start fresh with new questions:
1. Use the `/reset` command in Telegram
2. Confirm the deletion when prompted

## How it Works

The application uses:
- Node.js with node-schedule for timing
- Telegram Bot API for message delivery
- Gemini API for generating unique questions and answers
- SQLite for storing user data and question history

## License

MIT 