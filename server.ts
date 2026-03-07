import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from 'url';
import { QdrantClient } from '@qdrant/js-client-rest';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Qdrant Configuration (Lazy Initialization)
let qdrantClient: QdrantClient | null = null;
let isCollectionInitialized = false;
const QDRANT_COLLECTION = "research_memory";

const getQdrantClient = () => {
  if (qdrantClient) return qdrantClient;
  
  const url = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;
  
  if (url && apiKey) {
    try {
      qdrantClient = new QdrantClient({ url, apiKey });
      console.log("Qdrant Client Initialized");
      return qdrantClient;
    } catch (err) {
      console.error("Failed to initialize Qdrant client:", err);
      return null;
    }
  }
  return null;
};

// Ensure collection exists (Safe & Efficient)
const ensureCollection = async (client: QdrantClient) => {
  if (isCollectionInitialized) return true;
  try {
    const collections = await client.getCollections();
    const exists = collections.collections.some(c => c.name === QDRANT_COLLECTION);
    
    if (!exists) {
      await client.createCollection(QDRANT_COLLECTION, {
        vectors: { size: 768, distance: 'Cosine' }
      });
      console.log(`Qdrant collection '${QDRANT_COLLECTION}' created.`);
    }
    isCollectionInitialized = true;
    return true;
  } catch (err) {
    console.error("Failed to ensure Qdrant collection:", err);
    return false;
  }
};

// Helper to search memory (Effective RAG)
const searchMemory = async (query: string, ai: any) => {
  const client = getQdrantClient();
  if (!client) return null;

  try {
    if (!(await ensureCollection(client))) return null;

    // Generate Embedding for search
    const embedResponse = await ai.models.embedContent({
      model: "text-embedding-004",
      content: query
    });
    
    if (!embedResponse?.embedding?.values) {
      console.warn("Qdrant: No embedding values returned from Gemini");
      return null;
    }
    
    const vector = embedResponse.embedding.values;

    // Search Qdrant
    const searchResults = await client.search(QDRANT_COLLECTION, {
      vector,
      limit: 3,
      with_payload: true
    });

    if (searchResults.length > 0) {
      return searchResults.map(res => ({
        query: res.payload?.query,
        productName: res.payload?.productName,
        summary: res.payload?.summary,
        score: res.score
      }));
    }
  } catch (err) {
    console.error("Qdrant search failed:", err);
  }
  return null;
};

// Helper to save research to Qdrant (Error-Proof)
const saveToMemory = async (result: any, query: string, ai: any) => {
  const client = getQdrantClient();
  if (!client) return;

  try {
    if (!(await ensureCollection(client))) return;

    // 2. Generate Embedding for the query
    const embedResponse = await ai.models.embedContent({
      model: "text-embedding-004",
      content: query
    });
    
    if (!embedResponse?.embedding?.values) {
      console.warn("Qdrant: No embedding values returned for save");
      return;
    }
    
    const vector = embedResponse.embedding.values;

    // 3. Upsert into Qdrant
    await client.upsert(QDRANT_COLLECTION, {
      points: [{
        id: crypto.randomBytes(16).toString('hex'), // More robust ID generation for Node
        vector,
        payload: {
          query,
          productName: result.productName,
          summary: result.summary,
          timestamp: new Date().toISOString()
        }
      }]
    });
    console.log("Research saved to Qdrant memory");
  } catch (err) {
    console.error("Qdrant save failed:", err);
  }
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Route for Research
  app.post("/api/research", async (req, res) => {
    const { query, mode, kpis, marketplaces, category, goal, image } = req.body;

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

      const foundImages = serpData.inline_images?.slice(0, 4).map((img: any) => img.thumbnail) || 
                          serpData.images_results?.slice(0, 4).map((img: any) => img.thumbnail) || [];

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

      // Step 3: Search Memory for Context (RAG)
      const pastResearch = await searchMemory(query, ai);
      const memoryContext = pastResearch 
        ? `\n\nHere is relevant historical context from past research:\n${JSON.stringify(pastResearch)}`
        : "";

      const systemInstruction = `You are an E-commerce Research Agent. The user wants to analyze a product. 
      Their business goal is: ${goal}. 
      Focus on these KPIs: ${kpis.join(", ")}. 
      Target marketplaces: ${marketplaces.join(", ")}. 
      Category: ${category}.
      Mode: ${mode}.
      
      Here is the live web search data for the product:
      ${JSON.stringify(organicResults)}
      ${memoryContext}
      
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
            const parts: any[] = [{ text: `Analyze the product: ${query}` }];
            
            // Add user image if provided
            if (image && typeof image === 'string' && image.includes(';base64,')) {
              try {
                const [mimePart, base64Data] = image.split(';base64,');
                const mimeType = mimePart.split(':')[1];
                if (mimeType && base64Data) {
                  parts.push({
                    inlineData: {
                      mimeType,
                      data: base64Data
                    }
                  });
                }
              } catch (imgErr) {
                console.error("Failed to process user image:", imgErr);
              }
            }

            const response = await ai.models.generateContent({
              model: currentModel,
              contents: [{ parts }],
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
      result.foundImages = foundImages;
      
      // Save to Qdrant Memory (Async, don't wait for it)
      saveToMemory(result, query, ai).catch(err => console.error("Memory save failed:", err));

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
