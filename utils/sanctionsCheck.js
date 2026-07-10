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

function screenEntity(query) {
  const snapshot = loadSnapshot();

  // wallet_address and contract_address use identical matching logic -
  // both are address strings checked against the same SDN digital
  // currency address entries. This includes sanctioned mixer/contract
  // addresses (e.g. Tornado Cash), since OFAC lists those the same way
  // it lists personal wallet addresses in the official SDN data.
  if (query.type === 'wallet_address' || query.type === 'contract_address') {
    const target = normalizeAddress(query.value);
    const match = snapshot.entries.find(entry =>
      (entry.walletAddresses || []).some(addr => normalizeAddress(addr) === target)
    );
    if (match) {
      return {
        verdict: 'flagged',
        confidence: 1.0,
        matchedList: match.program,
        matchedEntry: match.primaryName,
        snapshotVersion: snapshot.snapshotVersion,
        generatedAt: snapshot.generatedAt
      };
    }
    return {
      verdict: 'clear',
      confidence: 1.0,
      snapshotVersion: snapshot.snapshotVersion,
      generatedAt: snapshot.generatedAt
    };
  }

  if (query.type === 'entity_name') {
    for (const entry of snapshot.entries) {
      const candidates = [entry.primaryName, ...(entry.aliases || [])];
      if (candidates.some(name => namesLikelyMatch(name, query.value))) {
        return {
          verdict: 'review_required',
          confidence: 0.75,
          matchedList: entry.program,
          matchedEntry: entry.primaryName,
          snapshotVersion: snapshot.snapshotVersion,
          generatedAt: snapshot.generatedAt
        };
      }
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
