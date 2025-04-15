const assert = require("assert");
const db = require("../src/database");

// Mock environment variables
process.env.GEMINI_API_KEY = "ADMIN_API_KEY";

// Unit tests for API key functionality
describe("API Key Management", function () {
  const TEST_CHAT_ID = "test-chat-id";
  const TEST_API_KEY = "AI_TEST_API_KEY_1234";

  before(async function () {
    // Initialize the database
    await db.initDatabase();

    // Create a test user
    await db.createUser(TEST_CHAT_ID, "Test User", "testuser");
  });

  it("should return the admin API key when user has no key", async function () {
    const apiKey = await db.getUserApiKey(TEST_CHAT_ID);
    assert.strictEqual(apiKey, "ADMIN_API_KEY");
  });

  it("should set and retrieve a user API key", async function () {
    await db.setUserApiKey(TEST_CHAT_ID, TEST_API_KEY);
    const apiKey = await db.getUserApiKey(TEST_CHAT_ID);
    assert.strictEqual(apiKey, TEST_API_KEY);
  });

  it("should remove a user API key", async function () {
    await db.setUserApiKey(TEST_CHAT_ID, null);
    const apiKey = await db.getUserApiKey(TEST_CHAT_ID);
    assert.strictEqual(apiKey, "ADMIN_API_KEY");
  });

  after(async function () {
    // Clean up test user
    if (db.db()) {
      await new Promise((resolve) => {
        db.db().run(
          "DELETE FROM users WHERE chat_id = ?",
          [TEST_CHAT_ID],
          resolve
        );
      });
      db.db().close();
    }
  });
});
