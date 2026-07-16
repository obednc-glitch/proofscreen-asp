require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const screenRoutes = require('./routes/screen');
const { buildSnapshot } = require('./scripts/fetchSnapshot');

const app = express();
app.use(express.json());

const X402_PRICE_USD = '0.01';
const X402_PRICE_ATOMIC = '10000'; // 0.01 USDT, 6 decimals
const X402_NETWORK = 'eip155:196';
const X402_ASSET = 'USDT';

function x402Gate(req, res, next) {
  const paymentHeader = req.header('X-PAYMENT');
  if (paymentHeader) {
    // Payment proof present — accept and proceed.
    // Full signature/settlement verification via OKX facilitator is Phase 3
    // (requires OKX API credentials, not yet provisioned).
    return next();
  }
  res.status(402).json({
    x402Version: 1,
    error: 'X-PAYMENT header is required',
    accepts: [
      {
        scheme: 'exact',
        network: X402_NETWORK,
        maxAmountRequired: X402_PRICE_ATOMIC,
        resource: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        description: 'ProofScreen sanctions screening',
        mimeType: 'application/json',
        payTo: process.env.X402_PAYTO_ADDRESS,
        maxTimeoutSeconds: 60,
        asset: X402_ASSET,
        extra: { priceUsd: X402_PRICE_USD }
      }
    ]
  });
}

app.use('/v1/screen', x402Gate);
app.use('/v1', screenRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'ProofScreen ASP' }));

cron.schedule('0 3 * * *', () => {
  console.log('Running scheduled SDN snapshot refresh...');
  buildSnapshot().catch(err => console.error('Scheduled snapshot refresh failed:', err.message));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ProofScreen ASP listening on port ${PORT}`);
});
