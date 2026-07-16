require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const screenRoutes = require('./routes/screen');
const { buildSnapshot } = require('./scripts/fetchSnapshot');
const { paymentMiddleware, x402ResourceServer } = require('@okxweb3/x402-express');
const { ExactEvmScheme } = require('@okxweb3/x402-evm/exact/server');
const { OKXFacilitatorClient } = require('@okxweb3/x402-core');

const app = express();
app.use(express.json());

const facilitatorClient = new OKXFacilitatorClient();
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register('eip155:196', new ExactEvmScheme());

const x402Routes = {
  'GET /v1/screen': {
    accepts: {
      scheme: 'exact',
      price: '$0.01',
      network: 'eip155:196',
      payTo: process.env.X402_PAYTO_ADDRESS,
      maxTimeoutSeconds: 60
    },
    description: 'ProofScreen sanctions screening'
  },
  'POST /v1/screen': {
    accepts: {
      scheme: 'exact',
      price: '$0.01',
      network: 'eip155:196',
      payTo: process.env.X402_PAYTO_ADDRESS,
      maxTimeoutSeconds: 60
    },
    description: 'ProofScreen sanctions screening'
  }
};

app.use(paymentMiddleware(x402Routes, resourceServer));
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
