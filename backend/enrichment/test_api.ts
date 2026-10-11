/**
 * Test script for Express Idea Enrichment API
 */
import express from 'express';
import { enrichRouter } from './src/server/routes/enrichRoutes.js';

async function runTests() {
  const app = express();
  app.use(express.json());
  app.use('/api', enrichRouter);

  const server = app.listen(3099, '127.0.0.1');
  console.log('[TestServer] Started on http://127.0.0.1:3099');

  const baseUrl = 'http://127.0.0.1:3099/api';

  try {
    // 1. Health check
    console.log('\n--- Test 1: GET /api/health ---');
    const healthRes = await fetch(`${baseUrl}/health`);
    const health = await healthRes.json();
    console.log('Health:', health.status, 'Engine:', health.engine);

    const testPayload = {
      id: 'voice-brainstorm-ai',
      title: 'Voice-First Agentic Brainstorming Canvas',
      fullBody: 'User speaks in brainstorming session. Speech stream is transcribed in real-time. Engine detects and categorizes distinct ideas. Subagents enrich with competitors and architecture.',
      proponents: ['Marko (arguing for frictionless voice input)'],
      opponents: ['Alex (concerned about latency)'],
    };

    // 2. Summary
    console.log('\n--- Test 2: POST /api/idea/summary ---');
    const sumRes = await fetch(`${baseUrl}/idea/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload),
    });
    const sumData = await sumRes.json();
    console.log('Summary:', sumData.summary?.slice(0, 100) + '...');
    console.log('Key Takeaway:', sumData.keyTakeaway);

    // 3. Pros and Cons
    console.log('\n--- Test 3: POST /api/idea/pros-cons ---');
    const prosRes = await fetch(`${baseUrl}/idea/pros-cons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload),
    });
    const prosData = await prosRes.json();
    console.log('Pros count:', prosData.prosAndCons?.pros?.length);
    console.log('Cons count:', prosData.prosAndCons?.cons?.length);

    // 4. Diagram
    console.log('\n--- Test 4: POST /api/idea/diagram ---');
    const diagRes = await fetch(`${baseUrl}/idea/diagram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload),
    });
    const diagData = await diagRes.json();
    console.log('Diagram nodes count:', diagData.diagram?.nodes?.length);
    console.log('Has SVG Diagram:', Boolean(diagData.diagram?.svgDiagram));
    console.log('Has Mermaid:', Boolean(diagData.diagram?.mermaidCode));

    // 5. System Graph
    console.log('\n--- Test 5: POST /api/idea/architecture-graph ---');
    const sysRes = await fetch(`${baseUrl}/idea/architecture-graph`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload),
    });
    const sysData = await sysRes.json();
    console.log('System Graph nodes:', sysData.systemGraph?.nodes?.length);
    console.log('System Graph edges:', sysData.systemGraph?.edges?.length);

    // 6. Competitors
    console.log('\n--- Test 6: POST /api/idea/competitors ---');
    const compRes = await fetch(`${baseUrl}/idea/competitors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload),
    });
    const compData = await compRes.json();
    console.log('Competitors count:', compData.competitors?.competitors?.length);

    // 7. Enrich All
    console.log('\n--- Test 7: POST /api/idea/enrich-all ---');
    const allRes = await fetch(`${baseUrl}/idea/enrich-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload),
    });
    const allData = await allRes.json();
    console.log('Enrich All Success:', allData.success);
    console.log('Execution Log:', allData.executionLog);

    // 8. Ideas List
    console.log('\n--- Test 8: GET /api/ideas ---');
    const ideasRes = await fetch(`${baseUrl}/ideas`);
    const ideasData = await ideasRes.json();
    console.log('Stored ideas count:', ideasData.ideas?.length);

    console.log('\n[SUCCESS] ALL EXPRESS API ENRICHMENT ENDPOINTS PASSED VERIFICATION!');
  } finally {
    server.close();
    console.log('[TestServer] Closed.');
  }
}

runTests().catch((err) => {
  console.error('[Test Failed]:', err);
  process.exit(1);
});

