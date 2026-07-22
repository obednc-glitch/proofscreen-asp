require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const screenRoutes = require('./routes/screen');
const { buildSnapshot } = require('./scripts/fetchSnapshot');

const app = express();
app.use(express.json());

const X402_NETWORK = 'eip155:196';
const X402_ASSET_ADDRESS = '0x779ded0c9e1022225f8e0630b35a9b54be713736';

function buildChallenge(req) {
  return {
    x402Version: 1,
    resource: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
    accepts: [
      {
        scheme: 'exact',
        network: X402_NETWORK,
        asset: X402_ASSET_ADDRESS,
        payTo: process.env.X402_PAYTO_ADDRESS,
        maxAmountRequired: '0',
        maxTimeoutSeconds: 60,
        extra: {}
      }
    ]
  };
}

function x402Gate(req, res, next) {
  const paymentHeader = req.header('X-PAYMENT');
  if (paymentHeader) {
    return next();
  }
  const challenge = buildChallenge(req);
  const encoded = Buffer.from(JSON.stringify(challenge)).toString('base64');
  res.set('PAYMENT-REQUIRED', encoded);
  res.status(402).json(challenge);
}

app.use('/v1/screen', x402Gate);
app.use('/v1', screenRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'ProofScreen ASP' }));

cron.schedule('0 3 * * *', () => {
  console.log('Running scheduled SDN snapshot refresh...');
  buildSnapshot().catch(err => console.error('Scheduled snapshot refresh failed:', err.message));
});

const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  cron.schedule('*/10 * * * *', () => {
    fetch(`${SELF_URL}/health`).catch(() => {});
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ProofScreen ASP listening on port ${PORT}`);
});
