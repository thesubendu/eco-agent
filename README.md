# EcomIntel: AI-Powered E-commerce Research Agent

EcomIntel is a high-fidelity research tool designed for e-commerce professionals. It automates market analysis, competitor tracking, and customer sentiment research by combining live web intelligence with advanced AI reasoning.

## 🚀 Key Features

- **Live Market Intelligence**: Fetches real-time data from the web using SerpApi to provide the most current market snapshot.
- **Gemini 2.5 Powered**: Leverages the latest Gemini 2.5 Flash model for deep reasoning and strategic insights.
- **Visual Analytics**:
  - **Agent Reasoning Flowchart**: Visualizes the step-by-step logic used by the AI to arrive at conclusions.
  - **Market Dashboard**: A radar chart summarizing Demand, Competition, and Growth potential.
  - **Price Comparison**: Visual bar charts comparing product prices across different sources.
  - **Sentiment Analysis**: Breakdown of customer sentiment (Positive, Neutral, Negative).
- **KPI-Aligned Insights**: Focuses on business-critical metrics like GMV, CAC, LTV, and Margins.
- **Dual Research Modes**:
  - **Quick Mode**: Rapid summaries of prices and complaints (< 2 mins).
  - **Deep Mode**: Comprehensive competitive analysis and demand trends (~10 mins).

## 🛠️ Tech Stack

- **Frontend**: React, Tailwind CSS, Lucide React, Motion (Framer Motion), Recharts.
- **Backend**: Node.js, Express, Vite (Middleware).
- **AI/Data**: Gemini 2.5 Flash, SerpApi.

## ⚙️ Setup & Deployment

1. **Environment Variables**:
   - `GEMINI_API_KEY`: Your Google Gemini API key.
   - `SERPAPI_KEY`: Your SerpApi key for live web search.
   - `QDRANT_URL`: (Optional) Your Qdrant cluster URL.
   - `QDRANT_API_KEY`: (Optional) Your Qdrant API key.
2. **Installation**:
   ```bash
   npm install
   ```
3. **Development**:
   ```bash
   npm run dev
   ```
4. **Production Build**:
   ```bash
   npm run build
   ```
5. **Start Server**:
   ```bash
   npm start
   ```

## 📝 License

MIT
