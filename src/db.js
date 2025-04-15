// Get a single setting value with default
async function getSetting(key, defaultValue = null) {
  try {
    const sql = "SELECT value FROM settings WHERE key = ?";
    const [rows] = await pool.query(sql, [key]);

    if (rows.length > 0) {
      return rows[0].value;
    }
    return defaultValue;
  } catch (error) {
    console.error(`Error getting setting ${key}:`, error);
    return defaultValue;
  }
}

// Update a single setting
async function updateSetting(key, value) {
  try {
    const sql =
      "INSERT INTO settings (key, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?";
    await pool.query(sql, [key, value, value]);
    return true;
  } catch (error) {
    console.error(`Error updating setting ${key}:`, error);
    return false;
  }
}

// Get admin users
async function getAdminUsers() {
  try {
    const sql = "SELECT * FROM users WHERE is_admin = 1";
    const [rows] = await pool.query(sql);
    return rows;
  } catch (error) {
    console.error("Error getting admin users:", error);
    return [];
  }
}

// Get pending users (not approved)
async function getPendingUsers() {
  try {
    const sql = "SELECT * FROM users WHERE is_approved = 0";
    const [rows] = await pool.query(sql);
    return rows;
  } catch (error) {
    console.error("Error getting pending users:", error);
    return [];
  }
}

// Create a user
async function createUser(chatId, firstName, lastName, isApproved = 0) {
  try {
    const sql = `
      INSERT INTO users (chat_id, first_name, last_name, is_approved, joined_date)
      VALUES (?, ?, ?, ?, NOW())
    `;
    await pool.query(sql, [chatId, firstName, lastName, isApproved]);
    return true;
  } catch (error) {
    console.error("Error creating user:", error);
    return false;
  }
}

// Get user API key
async function getUserApiKey(chatId) {
  try {
    const sql = "SELECT api_key FROM users WHERE chat_id = ?";
    const [rows] = await pool.query(sql, [chatId]);

    if (rows.length > 0) {
      return rows[0].api_key;
    }
    return null;
  } catch (error) {
    console.error("Error getting user API key:", error);
    return null;
  }
}

// Set user API key
async function setUserApiKey(chatId, apiKey) {
  try {
    const sql = "UPDATE users SET api_key = ? WHERE chat_id = ?";
    await pool.query(sql, [apiKey, chatId]);
    return true;
  } catch (error) {
    console.error("Error setting user API key:", error);
    return false;
  }
}

// Approve a user
async function approveUser(chatId) {
  try {
    const sql = "UPDATE users SET is_approved = 1 WHERE chat_id = ?";
    await pool.query(sql, [chatId]);
    return true;
  } catch (error) {
    console.error("Error approving user:", error);
    return false;
  }
}

module.exports = {
  getSetting,
  updateSetting,
  getAdminUsers,
  getPendingUsers,
  createUser,
  getUserApiKey,
  setUserApiKey,
  approveUser,
};
