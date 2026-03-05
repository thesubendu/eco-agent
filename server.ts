import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import path from "path";

import path from 'path';
import { fileURLToPath } from 'url';

// Recreate __filename and __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Route for Research
  app.post("/api/research", async (req, res) => {
    const { query, mode, kpis, marketplaces, category, goal } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    try {
      // Step 1: Fetch Live Data from SerpApi
      const serpApiKey = process.env.SERPAPI_KEY;
      if (!serpApiKey) {
        throw new Error("SERPAPI_KEY is not configured");
      }

      const serpApiUrl = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${serpApiKey}`;
      const serpResponse = await fetch(serpApiUrl);
      const serpData = await serpResponse.json();

      const organicResults = serpData.organic_results?.slice(0, 5).map((r: any) => ({
        title: r.title,
        link: r.link,
        snippet: r.snippet
      })) || [];

      // Step 2: LLM Processing with Gemini
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        throw new Error("GEMINI_API_KEY is not configured");
      }

      const ai = new GoogleGenAI({ apiKey: geminiApiKey });
      const systemInstruction = `You are an E-commerce Research Agent. The user wants to analyze a product. 
      Their business goal is: ${goal}. 
      Focus on these KPIs: ${kpis.join(", ")}. 
      Target marketplaces: ${marketplaces.join(", ")}. 
      Category: ${category}.
      Mode: ${mode}.
      
      Here is the live web search data for the product:
      ${JSON.stringify(organicResults)}
      
      Analyze this data and provide strategic insights.`;

      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash", // Using 1.5 flash as requested
        contents: [{ parts: [{ text: `Analyze the product: ${query}` }] }],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              productName: { type: Type.STRING },
              summary: { type: Type.STRING },
              sentimentScore: { type: Type.STRING, description: "e.g., 85/100" },
              topComplaints: { type: Type.ARRAY, items: { type: Type.STRING } },
              pricingInsights: { type: Type.STRING },
              strategicRecommendations: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["productName", "summary", "sentimentScore", "topComplaints", "pricingInsights", "strategicRecommendations"]
          }
        }
      });

      const result = JSON.parse(response.text || "{}");
      res.json(result);

    } catch (error: any) {
      console.error("Research Error:", error);
      res.status(500).json({ error: error.message || "Internal Server Error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static(path.resolve(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
