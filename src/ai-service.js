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
  // Truncate to first 40 characters if longer
  return question.length > 100 ? question.substring(0, 100) + "..." : question;
}

// Get keywords from recent questions to avoid repetition
async function getRecentQuestionKeywords() {
  try {
    const allQuestions = await db.getAllSentQuestions();
    // Sort by date descending and take the last 15
    return allQuestions
      .sort((a, b) => new Date(b.sent_date) - new Date(a.sent_date))
      .slice(0, 60)
      .map((q) => extractKeywords(q.question));
  } catch (error) {
    console.error("Error fetching recent questions:", error);
    return [];
  }
}

// Generate a random JS/TS/React interview question and answer using Gemini
async function generateQuestion(
  specificCategory = null,
  userId = null,
  language = "en"
) {
  try {
    // Use specified category or pick randomly
    const category =
      specificCategory ||
      CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];

    // Get recent questions keywords to avoid repetition
    const recentKeywords = await getRecentQuestionKeywords();
    const avoidTopicsText =
      recentKeywords.length > 0
        ? `\n\nAvoid questions about these topics: ${recentKeywords.join(", ")}`
        : "";

    // Create appropriate prompt based on language preference
    let prompt;

    if (language === "es") {
      // Spanish prompt
      prompt = `Genera una pregunta de entrevista detallada de nivel senior sobre ${category}.

      Responde SOLO con esta estructura JSON:
      
      {
        "question": "Tu pregunta de entrevista en español aquí",
        "answer": "Respuesta detallada con explicaciones, conceptos fundamentales y ejemplos de código"
      }
      
      Asegúrate que:
      1. La pregunta sea clara y específica.
      2. La respuesta sea didáctica y completa, explicando conceptos fundamentales.
      3. Incluya ejemplos de código prácticos y bien comentados.
      4. Mencione casos de uso reales o mejores prácticas.
      5. Si es relevante, explique las ventajas/desventajas o comparativas con otras técnicas.
      
      Ejemplos de preguntas:
      - "Explica qué es un closure en JavaScript y proporciona ejemplos prácticos de su uso"
      - "¿Cómo funciona el manejo de estados en Redux y cuáles son sus ventajas frente a otras soluciones?"
      - "Explica el funcionamiento de los operadores Rest y Spread en JavaScript, sus diferencias y casos de uso"
      
      La respuesta debe ser extensa, didáctica y con ejemplos de código bien explicados.${avoidTopicsText}`;
    } else {
      // English prompt (default)
      prompt = `Generate a detailed senior-level interview question about ${category}.
      
      Respond ONLY with this JSON structure:
      
      {
        "question": "Your interview question here",
        "answer": "Detailed answer with explanations, key concepts, and code examples"
      }
      
      Ensure that:
      1. The question is clear and specific.
      2. The answer is educational and comprehensive, explaining fundamental concepts.
      3. Include practical, well-commented code examples.
      4. Mention real-world use cases or best practices.
      5. If relevant, explain advantages/disadvantages or comparisons with other techniques.
      
      The answer should be extensive, educational, and include well-explained code examples.${avoidTopicsText}`;
    }

    // Get the AI client for this user
    const ai = await getAIClient(userId);

    // If no API key is available, throw an error
    if (!ai) {
      throw new Error("API key required but not available");
    }

    // Generate content with Gemini
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });

    // Debug the raw response before extraction
    console.log("Raw response:", response.text.substring(0, 100) + "...");

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
