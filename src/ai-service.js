const { GoogleGenAI, Type } = require("@google/genai");
const db = require("./database");
require("dotenv").config();

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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
async function generateQuestion(specificCategory = null) {
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

    // Create a prompt for Gemini with JSON schema in the prompt
    const prompt = `Generate a mid to senior level interview question about ${category}.

    Respond ONLY with this JSON structure:
    
    {
      "question": "Your interview question in Spanish here",
      "answer": "Comprehensive answer with code examples if relevant"
    }
    
    The question should be in Spanish like these examples:
    - "Que es un closure en javascript y poner un ejemplo?"
    - "Como funciona el manejo de estados en redux? Poner un ejemplo."
    - "Rest y spreed operator como funciona y ejemplos."
    
    If it's a coding question, provide a code example in the answer.
    Make sure the answer is thorough but not too long (maximum 1000 characters).${avoidTopicsText}`;

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

    // Provide a fallback question if AI generation fails
    return {
      question: "¿Qué es un closure en JavaScript y cómo se utiliza?",
      answer:
        "Un closure es una función que tiene acceso a variables de su ámbito exterior, incluso después de que la función exterior ha terminado de ejecutarse. Esto sucede porque la función interna mantiene una referencia al ámbito léxico de la función exterior.\n\nEjemplo:\n```javascript\nfunction crearContador() {\n  let contador = 0;\n  return function() {\n    contador++;\n    return contador;\n  };\n}\n\nconst incrementar = crearContador();\nconsole.log(incrementar()); // 1\nconsole.log(incrementar()); // 2\n```\n\nEn este ejemplo, la función interna retornada por `crearContador` forma un closure sobre la variable `contador`, permitiéndole acceder y modificar esta variable incluso después de que `crearContador` haya terminado de ejecutarse.",
      category: specificCategory || "javascript",
    };
  }
}

module.exports = {
  generateQuestion,
};
