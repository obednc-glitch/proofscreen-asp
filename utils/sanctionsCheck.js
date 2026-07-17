const fs = require('fs');
const path = require('path');

function loadSnapshot() {
  const realPath = path.join(__dirname, '..', 'data', 'sdn-snapshot.json');
  const samplePath = path.join(__dirname, '..', 'data', 'sdn-snapshot.sample.json');
  const filePath = fs.existsSync(realPath) ? realPath : samplePath;
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  return { ...data, isSample: filePath === samplePath };
}

function normalize(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAddress(addr) {
  return String(addr).toLowerCase().trim();
}

function namesLikelyMatch(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  if (na.length > 3 && nb.includes(na)) return true;
  if (nb.length > 3 && na.includes(nb)) return true;
  return false;
}

const TYPE_ALIASES = {
  wallet: 'wallet_address', address: 'wallet_address', wallet_address: 'wallet_address',
  contract: 'contract_address', contract_address: 'contract_address',
  entity: 'entity_name', name: 'entity_name', entity_name: 'entity_name'
};

function normalizeQueryType(type) {
  return TYPE_ALIASES[String(type).toLowerCase().trim()] || null;
}

function dedupe(arr) {
  return [...new Set(arr)];
}

function buildMatchResult(matches, snapshot, verdict, confidence) {
  return {
    verdict,
    confidence,
    matched_list: dedupe(matches.map(m => m.program)),
    matched_source_list: dedupe(matches.map(m => m.sourceList || 'UNKNOWN')),
    matchedEntries: matches.map(m => m.primaryName),
    matchCount: matches.length,
    snapshotVersion: snapshot.snapshotVersion,
    generatedAt: snapshot.generatedAt
  };
}

function screenEntity(query) {
  const snapshot = loadSnapshot();
  const resolvedType = normalizeQueryType(query.type);

  if (resolvedType === 'wallet_address' || resolvedType === 'contract_address') {
    const target = normalizeAddress(query.value);
    const matches = snapshot.entries.filter(entry =>
      (entry.walletAddresses || []).some(addr => normalizeAddress(addr) === target)
    );
    if (matches.length > 0) {
      return buildMatchResult(matches, snapshot, 'flagged', 1.0);
    }
    return {
      verdict: 'clear',
      confidence: 1.0,
      snapshotVersion: snapshot.snapshotVersion,
      generatedAt: snapshot.generatedAt
    };
  }

  if (resolvedType === 'entity_name') {
    const matches = snapshot.entries.filter(entry => {
      const candidates = [entry.primaryName, ...(entry.aliases || [])];
      return candidates.some(name => namesLikelyMatch(name, query.value));
    });
    if (matches.length > 0) {
      return buildMatchResult(matches, snapshot, 'review_required', 0.75);
    }
    return {
      verdict: 'clear',
      confidence: 0.9,
      snapshotVersion: snapshot.snapshotVersion,
      generatedAt: snapshot.generatedAt
    };
  }

  throw new Error(`Unsupported query type: ${query.type}`);
}

module.exports = { screenEntity, loadSnapshot };
