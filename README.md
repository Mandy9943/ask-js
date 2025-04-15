# Daily JavaScript Interview Questions Bot

A Telegram bot that sends you daily JavaScript, TypeScript, and React interview questions to help you keep your programming knowledge fresh.

## Features

- Daily interview questions for mid and senior-level JavaScript, TypeScript, and React developers
- Filter questions by programming language/framework
- AI-generated questions and answers using Gemini API
- Delivered directly to your Telegram
- Locally stored question history to avoid repetition
- No paid services required (apart from Gemini API, which has a free tier)
- Customizable schedule for daily questions
- Database management commands

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
   
4. Get your Telegram Chat ID:
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
   
7. Edit the `.env` file with your keys and preferences

## Usage

Start the bot:

```bash
npm start
```

The bot will automatically send you a new question every day at the scheduled time (default: 9 AM).

## Commands

- `/start` - Start the bot
- `/question [category]` - Get a question immediately (optional: specify javascript/js, typescript/ts, or react)
- `/reset` - Reset the question database (delete all questions)
- `/schedule HH:MM` - Change the daily question time (e.g., /schedule 08:30)
- `/help` - Show help information

## Customization

### Filtering Questions by Category

You can filter questions by technology:

- `/question javascript` or `/question js` - Get a JavaScript question
- `/question typescript` or `/question ts` - Get a TypeScript question
- `/question react` - Get a React question
- `/question` - Get a random question from any category

### Changing the Question Schedule

You can change when you receive questions in two ways:

1. Using the Telegram bot command:
   ```
   /schedule 08:30
   ```
   This sets the bot to send questions at 8:30 AM every day.

2. By editing the `.env` file:
   ```
   QUESTION_SCHEDULE="0 8 * * *"
   ```
   This uses cron syntax for more advanced scheduling (minutes hour day_of_month month day_of_week).

### Database Management

If you want to start fresh with new questions:
1. Use the `/reset` command in Telegram
2. Confirm the deletion when prompted

## How it Works

The application uses:
- Node.js with node-schedule for timing
- Telegram Bot API for message delivery
- Gemini API for generating unique questions and answers
- SQLite for storing question history

## License

MIT 