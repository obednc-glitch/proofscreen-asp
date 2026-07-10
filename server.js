require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const screenRoutes = require('./routes/screen');
const { buildSnapshot } = require('./scripts/fetchSnapshot');

const app = express();
app.use(express.json());

app.use('/v1', screenRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'ProofScreen ASP' }));

// Auto-refresh the full SDN snapshot once a day
cron.schedule('0 3 * * *', () => {
  console.log('Running scheduled SDN snapshot refresh...');
  buildSnapshot().catch(err => console.error('Scheduled snapshot refresh failed:', err.message));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ProofScreen ASP listening on port ${PORT}`);
});
