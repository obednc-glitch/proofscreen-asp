const express = require('express');
const router = express.Router();
const { screenEntity } = require('../utils/sanctionsCheck');
const { anchorReport, verifyReport } = require('../utils/chainClient');

function normalizeQuery(body) {
  if (body.query && body.query.type && body.query.value) return body.query;
  const wallet = body.wallet_address || body.wallet || body.address;
  const contract = body.contract_address || body.contract;
  const entity = body.entity_name || body.entity || body.name;
  if (wallet) return { type: 'wallet', value: wallet };
  if (contract) return { type: 'contract', value: contract };
  if (entity) return { type: 'entity', value: entity };
  return null;
}

async function handleScreen(req, res) {
  try {
    const query = normalizeQuery(req.body || {});
    if (!query) {
      return res.status(400).json({ error: 'wallet_address, contract_address, or entity_name is required' });
    }
    const screening = screenEntity(query);
    const report = { query, requester: req.body.requester || null, screening, timestamp: new Date().toISOString() };
    const proof = await anchorReport(report);

    const snapshotAgeMs = screening.generatedAt ? Date.now() - new Date(screening.generatedAt).getTime() : null;
    const snapshotAgeHours = snapshotAgeMs !== null ? Math.round(snapshotAgeMs / 3600000) : null;

    res.json({
      verdict: screening.verdict,
      confidence: screening.confidence,
      matched_list: screening.matchedList,
      matched_source_list: screening.matchedSourceList,
      snapshot_version: screening.snapshotVersion,
      snapshot_age_hours: snapshotAgeHours,
      proof: { hash: proof.hash, anchored_tx: proof.txHash, chain: proof.chain, timestamp: report.timestamp },
      fee: { amount: '0.01', currency: 'USDT', status: 'paid' }
    });
  } catch (err) {
    console.error('Error in /v1/screen:', err);
    res.status(500).json({ error: 'Internal error during screening' });
  }
}

router.get('/screen', handleScreen);
router.post('/screen', handleScreen);

router.get('/verify/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      return res.status(400).json({ error: 'hash must be a 0x-prefixed 32-byte hex string' });
    }
    const result = await verifyReport(hash);
    res.json(result);
  } catch (err) {
    console.error('Error in /v1/verify:', err);
    res.status(500).json({ error: 'Internal error during verification' });
  }
});

module.exports = router;
