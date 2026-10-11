/**
 * Brainstorm Idea Enrichment API Server
 * Node.js Express server mounting /api routes with Vite middlewares on port 3000.
 */
import './src/server/environment.js';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { enrichRouter } from './src/server/routes/enrichRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  // Body parser for JSON payloads
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // CORS
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Health and root status
  app.get('/', (_req, res) => {
    res.json({
      service: 'Brainstorm Idea Enrichment API',
      status: 'online',
      storage: 'data/ideas.json',
      endpoints: {
        health: '/api/enrich/health',
        ideas: '/api/enrich/ideas',
        ideaById: '/api/enrich/ideas/:id',
        enrichSummary: 'POST /api/enrich/summary',
        enrichProsCons: 'POST /api/enrich/pros-cons',
        enrichDiagram: 'POST /api/enrich/diagram',
        enrichSystemGraph: 'POST /api/enrich/system-graph',
        enrichCompetitors: 'POST /api/enrich/competitors',
        enrichAll: 'POST /api/enrich/all',
      }
    });
  });

  // Mount API endpoints
  app.use('/api', enrichRouter);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Brainstorm Idea Enrichment Engine running on http://0.0.0.0:${PORT}`);
    console.log(`[Server] API Endpoints mounted at /api/enrich/*`);
  });
}

startServer().catch((err) => {
  console.error('[Server] Failed to initialize server:', err);
  process.exit(1);
});
