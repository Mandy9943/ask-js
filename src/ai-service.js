const { GoogleGenAI } = require("@google/genai");
const db = require("./database");
require("dotenv").config();

// Initialize Gemini with a dynamic API key function
async function getAIClient(userId) {
  // Get the appropriate API key (user's key or admin key)
  const apiKey = await db.getUserApiKey(userId);

  // If no API key is available, return null
  if (!apiKey) {
    return null;
  }

  // Create a new client with this key
  return new GoogleGenAI({ apiKey });
}

// Categories of questions
const CATEGORIES = ["javascript", "typescript", "react"];

// Function to clean the response and extract JSON
function extractJSON(text) {
  try {
    // Try parsing the response directly first
    return JSON.parse(text);
  } catch (e) {
    // If direct parsing fails, try to extract JSON from markdown
    try {
      // Remove markdown code block indicators if present
      const jsonPattern = /```(?:json)?\s*([\s\S]*?)```/;
      const match = text.match(jsonPattern);

      // If we found a JSON code block, extract it, otherwise use the full text
      const cleanedText = match ? match[1] : text;

      // Parse the cleaned text
      return JSON.parse(cleanedText.trim());
    } catch (e2) {
      // If JSON is still broken, try to reconstruct it if it has the expected keys
      try {
        // Extract keys using regex
        const questionMatch = /\"question\":\s*\"(.*?)\"/s.exec(text);
        const answerMatch = /\"answer\":\s*\"(.*?)(?=\"\s*\}|$)/s.exec(text);

        if (questionMatch && answerMatch) {
          // Reconstruct JSON with the extracted values
          return {
            question: questionMatch[1].replace(/\\n/g, "\n"),
            answer: answerMatch[1].replace(/\\n/g, "\n"),
          };
        }

        throw new Error("Failed to extract question and answer");
      } catch (e3) {
        console.error("All JSON extraction methods failed:", e3);
        throw new Error("Failed to parse AI response");
      }
    }
  }
}

// Extract key concepts from previous questions
function extractKeywords(question) {
  // Truncate to first 150 characters if longer, aiming for the core topic
  return question.length > 150
    ? question.substring(0, 150).trim() + "..."
    : question.trim();
}

// Get topics from recent questions to avoid repetition
async function getRecentQuestionTopics(dbUserId) {
  if (!dbUserId) {
    console.warn(
      "Attempted to get recent topics without a valid database user ID."
    );
    return []; // Cannot fetch history without the correct ID
  }
  try {
    const allQuestions = await db.getAllSentQuestions(dbUserId);
    // Sort by date descending and take the last 20
    return allQuestions
      .sort((a, b) => new Date(b.sent_date) - new Date(a.sent_date))
      .slice(0, 20) // Fetch last 20 questions
      .map((q) => extractKeywords(q.question)); // Extract keywords/topics
  } catch (error) {
    console.error("Error fetching recent question topics:", error);
    return [];
  }
}

// Generate a random JS/TS/React interview question and answer using Gemini
async function generateQuestion(
  specificCategory = null,
  chatId = null,
  language = "en"
) {
  try {
    // First, get the internal database user ID from the chatId
    let dbUserId = null;
    if (chatId) {
      const user = await db.getUser(chatId); // Fetch user by chat ID
      if (user) {
        dbUserId = user.id; // Get the actual database ID
      } else {
        console.warn(
          `User not found for chatId ${chatId} in generateQuestion.`
        );
      }
    }

    // Use specified category or pick randomly
    const category =
      specificCategory ||
      CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];

    // Get recent questions topics to avoid repetition, using the database user ID
    const recentTopics = await getRecentQuestionTopics(dbUserId);
    const avoidTopicsText =
      recentTopics.length > 0
        ? `\n\nCRITICAL INSTRUCTION: Ensure the new question is substantially different from the following topics recently asked to this user. Do NOT repeat or rephrase questions related to these topics:\n- ${recentTopics.join(
            "\n- "
          )}`
        : "";

    // Create appropriate prompt based on language preference
    let prompt;

    if (language === "es") {
      // Spanish prompt
      prompt = `Genera una pregunta de entrevista de nivel senior sobre ${category} que se pueda discutir y resolver en aproximadamente 5 minutos.
      Evita escenarios excesivamente complejos o que requieran diseñar sistemas grandes.
      Enfócate en un concepto específico, un pequeño problema de código o una explicación clara.

      Responde SOLO con esta estructura JSON:
      
      {
        "question": "Tu pregunta de entrevista en español aquí (clara y concisa)",
        "answer": "Respuesta concisa y correcta, explicando el concepto clave o la solución"
      }
      
      Asegúrate que:
      1. La pregunta sea típica de una entrevista técnica.
      2. La respuesta sea directa y precisa.
      3. Si es código, que sea un ejemplo breve y claro.
      
      Ejemplos de preguntas adecuadas:
      - "¿Cuál es la diferencia entre '==' y '===' en JavaScript y cuándo usarías cada uno?"
      - "Escribe una función que invierta una cadena de texto sin usar métodos incorporados."
      - "Explica el concepto de 'event delegation' en el DOM."
      - "¿Qué problema resuelve 'Promise.all' y cómo se usa?"
      
      La respuesta debe ser la solución o explicación directa y concisa.${avoidTopicsText}`;
    } else {
      // English prompt (default)
      prompt = `Generate a senior-level interview question about ${category} that can be discussed and solved in about 5 minutes.
      Avoid overly complex scenarios or large system design questions.
      Focus on a specific concept, a small coding problem, or a clear explanation.
      
      Respond ONLY with this JSON structure:
      
      {
        "question": "Your interview question here (clear and concise)",
        "answer": "Concise and correct answer, explaining the key concept or solution"
      }
      
      Ensure that:
      1. The question is typical for a technical interview.
      2. The answer is direct and accurate.
      3. If code is involved, it's a short and clear example.
      
      Examples of suitable questions:
      - "What's the difference between '==' and '===' in JavaScript and when would you use each?"
      - "Write a function to reverse a string without using built-in methods."
      - "Explain the concept of event delegation in the DOM."
      - "What problem does 'Promise.all' solve and how is it used?"
      
      The answer should be the direct and concise solution or explanation.${avoidTopicsText}`;
    }

    // Get the AI client for this user (using chatId to get API key)
    const ai = await getAIClient(chatId);

    // If no API key is available, throw an error
    if (!ai) {
      throw new Error("API key required but not available");
    }

    // Generate content with Gemini
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });

    // Extract and parse JSON from the response
    const result = extractJSON(response.text);

    return {
      question: result.question,
      answer: result.answer,
      category,
    };
  } catch (error) {
    console.error("Error generating question:", error);
    console.error("Raw response:", error.response?.text);

    if (error.message && error.message.includes("API key not valid")) {
      throw new Error("API key is invalid or has expired");
    }

    if (error.message && error.message.includes("API key required")) {
      throw new Error("API key required but not provided");
    }

    // Provide a fallback question based on language
    if (language === "es") {
      return {
        question: "¿Qué es un closure en JavaScript y cómo se utiliza?",
        answer:
          "Un closure es una función que tiene acceso a variables de su ámbito exterior, incluso después de que la función exterior ha terminado de ejecutarse. Esto sucede porque la función interna mantiene una referencia al ámbito léxico de la función exterior.\n\nEjemplo:\n```javascript\nfunction crearContador() {\n  let contador = 0;\n  return function() {\n    contador++;\n    return contador;\n  };\n}\n\nconst incrementar = crearContador();\nconsole.log(incrementar()); // 1\nconsole.log(incrementar()); // 2\n```\n\nEn este ejemplo, la función interna retornada por `crearContador` forma un closure sobre la variable `contador`, permitiéndole acceder y modificar esta variable incluso después de que `crearContador` haya terminado de ejecutarse.",
        category: specificCategory || "javascript",
      };
    } else {
      return {
        question: "What is a closure in JavaScript and how is it used?",
        answer:
          "A closure is a function that has access to variables from its outer scope, even after the outer function has finished executing. This happens because the inner function maintains a reference to the lexical scope of the outer function.\n\nExample:\n```javascript\nfunction createCounter() {\n  let count = 0;\n  return function() {\n    count++;\n    return count;\n  };\n}\n\nconst increment = createCounter();\nconsole.log(increment()); // 1\nconsole.log(increment()); // 2\n```\n\nIn this example, the inner function returned by `createCounter` forms a closure over the `count` variable, allowing it to access and modify this variable even after `createCounter` has finished executing.",
        category: specificCategory || "javascript",
      };
    }
  }
}

module.exports = {
  generateQuestion,
};
