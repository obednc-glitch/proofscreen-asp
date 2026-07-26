require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { ethers } = require('ethers');
const screenRoutes = require('./routes/screen');
const { buildSnapshot } = require('./scripts/fetchSnapshot');

const app = express();
app.use(express.json());

const X402_NETWORK = 'eip155:196';
const X402_ASSET_ADDRESS = '0x779ded0c9e1022225f8e0630b35a9b54be713736';
const X402_ASSET_NAME = 'USDT0';
const X402_ASSET_VERSION = '1';
const X402_ASSET_DECIMALS = 6;
const X402_CHAIN_ID = 196;

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' }
  ]
};

function eip3009Domain() {
  return {
    name: X402_ASSET_NAME,
    version: X402_ASSET_VERSION,
    chainId: X402_CHAIN_ID,
    verifyingContract: X402_ASSET_ADDRESS
  };
}

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
        amount: '0',
        maxTimeoutSeconds: 60,
        extra: {
          name: X402_ASSET_NAME,
          version: X402_ASSET_VERSION,
          decimals: X402_ASSET_DECIMALS
        }
      }
    ]
  };
}

const usedNonces = new Set();

function verifyPayment(paymentHeader) {
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));
  } catch (err) {
    return { valid: false, reason: 'Malformed X-PAYMENT header' };
  }

  const { scheme, network, payload } = decoded;
  if (scheme !== 'exact') {
    return { valid: false, reason: 'Unsupported x402 scheme' };
  }
  if (network !== X402_NETWORK) {
    return { valid: false, reason: 'Unsupported network' };
  }

  const auth = payload && payload.authorization;
  const signature = payload && payload.signature;
  if (!auth || !signature) {
    return { valid: false, reason: 'Missing authorization or signature' };
  }

  const { from, to, value, validAfter, validBefore, nonce } = auth;
  if (!from || !to || value === undefined || !nonce) {
    return { valid: false, reason: 'Incomplete authorization fields' };
  }

  if (to.toLowerCase() !== (process.env.X402_PAYTO_ADDRESS || '').toLowerCase()) {
    return { valid: false, reason: 'payTo mismatch' };
  }

  let providedValue;
  try {
    providedValue = BigInt(value);
  } catch (err) {
    return { valid: false, reason: 'Invalid value field' };
  }
  if (providedValue < 0n) {
    return { valid: false, reason: 'Negative value' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Number(validAfter) > nowSec || Number(validBefore) < nowSec) {
    return { valid: false, reason: 'Authorization outside valid time window' };
  }

  const nonceKey = `${from.toLowerCase()}:${nonce}`;
  if (usedNonces.has(nonceKey)) {
    return { valid: false, reason: 'Nonce already used' };
  }

  let recovered;
  try {
    recovered = ethers.verifyTypedData(
      eip3009Domain(),
      EIP3009_TYPES,
      { from, to, value, validAfter, validBefore, nonce },
      signature
    );
  } catch (err) {
    return { valid: false, reason: 'Signature verification error' };
  }

  if (recovered.toLowerCase() !== from.toLowerCase()) {
    return { valid: false, reason: 'Signature does not match from address' };
  }

  usedNonces.add(nonceKey);
  return { valid: true, payer: from };
}

function x402Gate(req, res, next) {
  const challenge = buildChallenge(req);
  const paymentHeader = req.header('X-PAYMENT');

  if (paymentHeader) {
    const result = verifyPayment(paymentHeader);
    if (result.valid) {
      const receipt = {
        success: true,
        payer: result.payer,
        network: X402_NETWORK,
        asset: X402_ASSET_ADDRESS,
        amount: '0',
        settled: false
      };
      res.set('X-PAYMENT-RESPONSE', Buffer.from(JSON.stringify(receipt)).toString('base64'));
      return next();
    }
    console.warn('x402 payment rejected:', result.reason);
  }

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
