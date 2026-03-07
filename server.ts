import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import path from "path";

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
      let geminiApiKey = process.env.GEMINI_API_KEY;
      
      // Clean the API key (remove quotes and whitespace)
      if (geminiApiKey) {
        geminiApiKey = geminiApiKey.replace(/['"]+/g, '').trim();
      }
      
      if (!geminiApiKey || geminiApiKey === "MY_GEMINI_API_KEY" || geminiApiKey === "") {
        return res.status(401).json({ 
          error: "Invalid Gemini API Key. Please ensure GEMINI_API_KEY is correctly set in your environment variables. If you are on Render/Vercel, add it to the dashboard settings without quotes." 
        });
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
      
      Analyze this data and provide strategic insights.
      
      IMPORTANT: You must provide data for visual components:
      1. reasoningFlow: A step-by-step breakdown of how you arrived at your conclusions.
      2. priceComparison: Actual or estimated price points found in the search data.
      3. marketDashboard: Numerical scores (1-100) for market health metrics.`;

      // Helper for retrying with exponential backoff
      const callGeminiWithRetry = async (retries = 3, delay = 2000) => {
        const currentModel = "gemini-2.5-flash"; // Using Gemini 2.5 only as requested
        for (let i = 0; i < retries; i++) {
          try {
            const response = await ai.models.generateContent({
              model: currentModel,
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
                    sentimentData: { 
                      type: Type.ARRAY, 
                      items: { 
                        type: Type.OBJECT,
                        properties: {
                          label: { type: Type.STRING },
                          value: { type: Type.NUMBER }
                        }
                      }
                    },
                    reasoningFlow: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          step: { type: Type.STRING },
                          detail: { type: Type.STRING },
                          type: { type: Type.STRING, description: "one of: search, analysis, strategy" }
                        }
                      }
                    },
                    priceComparison: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          product: { type: Type.STRING },
                          price: { type: Type.NUMBER },
                          source: { type: Type.STRING }
                        }
                      }
                    },
                    marketDashboard: {
                      type: Type.OBJECT,
                      properties: {
                        demandScore: { type: Type.NUMBER },
                        competitionLevel: { type: Type.NUMBER },
                        growthPotential: { type: Type.NUMBER }
                      }
                    },
                    competitors: { 
                      type: Type.ARRAY, 
                      items: { 
                        type: Type.OBJECT,
                        properties: {
                          name: { type: Type.STRING },
                          marketShare: { type: Type.STRING },
                          strength: { type: Type.STRING }
                        }
                      } 
                    },
                    topComplaints: { type: Type.ARRAY, items: { type: Type.STRING } },
                    pricingInsights: { type: Type.STRING },
                    strategicRecommendations: { type: Type.ARRAY, items: { type: Type.STRING } }
                  },
                  required: [
                    "productName", "summary", "sentimentScore", "sentimentData", 
                    "reasoningFlow", "priceComparison", "marketDashboard",
                    "competitors", "topComplaints", "pricingInsights", "strategicRecommendations"
                  ]
                }
              }
            });
            return response;
          } catch (err: any) {
            const isRetryable = err.message?.includes("503") || err.message?.includes("high demand") || err.status === 503;
            if (isRetryable && i < retries - 1) {
              console.log(`${currentModel} busy, retrying in ${delay}ms... (Attempt ${i + 1}/${retries})`);
              await new Promise(resolve => setTimeout(resolve, delay));
              delay *= 2; // Exponential backoff
              continue;
            }
            throw err;
          }
        }
      };

      const response = await callGeminiWithRetry();
      if (!response) throw new Error("Failed to get response from Gemini after retries");

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
