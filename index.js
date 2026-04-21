'use strict';

const createApp = require('./src/app');

const PORT = process.env.PORT || 3000;
const app  = createApp();

app.listen(PORT, () => {
  console.log(`Rate-limited API listening on http://localhost:${PORT}`);
  console.log('  POST /request   — submit a request');
  console.log('  GET  /stats     — view usage statistics');
  console.log('  GET  /health    — health check');
});
