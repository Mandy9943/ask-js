# API Key Management

This document explains how API keys work in the JavaScript Interview Questions Bot.

## Overview

The bot uses the Gemini API to generate interview questions. By default, all users share the bot administrator's API key defined in the `.env` file. However, users can set their own personal API keys for a better experience.

## Benefits of Using Personal API Keys

1. **Custom Usage Limits**: Each user gets their own quota and rate limits with Google's API
2. **Better Privacy**: Your questions are generated using your own key
3. **More Control**: You can manage your own API usage and billing

## How to Set Up Your API Key

### Step 1: Get a Gemini API Key

1. Visit [Google AI Studio](https://ai.google.dev/)
2. Create an account if you don't have one
3. Navigate to API keys and create a new key
4. Copy your new API key

### Step 2: Set Your API Key in the Bot

Use the `/setapikey` command in the bot:

```
/setapikey YOUR_API_KEY_HERE
```

For example:
```
/setapikey AIzaSyB1234567890abcdefghijklmnopqrstuvwxyz
```

### Step 3: Verify Your API Key Status

Use the `/help` command to see your API key status:
```
/help
```

You should see a line that says `Your API key status: ✅ Set`

## Removing Your API Key

If you want to stop using your personal API key, you can remove it with:

```
/deleteapikey
```

After removing your personal key, the bot will automatically use the admin's API key.

## Implementation Details

The bot handles API keys in the following ways:

1. When a user sets their API key, it's stored securely in the database
2. When generating questions, the system checks if the user has a personal API key
3. If a personal key exists, it's used instead of the admin key
4. If the personal key is invalid or removed, the system falls back to the admin key

## Troubleshooting

If you get an error when setting your API key, check:

1. The API key format (Gemini API keys typically start with "AI")
2. That your key is active in Google AI Studio
3. That you have quota available for the Gemini API

For further assistance, contact the bot administrator. 