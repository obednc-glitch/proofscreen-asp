const https = require('https');
const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const OFAC_XML_URL = 'https://www.treasury.gov/ofac/downloads/sdn.xml';
const UN_XML_URL = 'https://scsanctions.un.org/resources/xml/en/consolidated.xml';
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'sdn-snapshot.json');

function downloadXml(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProofScreenASP/1.0)' }
    };
    https.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadXml(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

// ---------- OFAC ----------

function extractOfacAliases(entry) {
  const akaList = entry.akaList && entry.akaList.aka;
  return toArray(akaList)
    .map(aka => {
      const parts = [aka.firstName, aka.lastName].filter(Boolean);
      return parts.length ? parts.join(' ') : (aka.uid || null);
    })
    .filter(Boolean);
}

function extractOfacWalletAddresses(entry) {
  const idList = entry.idList && entry.idList.id;
  return toArray(idList)
    .filter(id => id.idType && /digital currency address/i.test(id.idType))
    .map(id => id.idNumber)
    .filter(Boolean);
}

function extractOfacName(entry) {
  if (entry.lastName && entry.firstName) return `${entry.firstName} ${entry.lastName}`;
  return entry.lastName || entry.firstName || 'UNKNOWN';
}

function extractOfacProgram(entry) {
  const programList = entry.programList && entry.programList.program;
  const programs = toArray(programList);
  return programs.length ? programs.join(', ') : 'UNSPECIFIED';
}

async function fetchOfacEntries() {
  console.log(`Downloading OFAC SDN list from ${OFAC_XML_URL} ...`);
  const xml = await downloadXml(OFAC_XML_URL);
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);
  const rawEntries = toArray(parsed?.sdnList?.sdnEntry);
  console.log(`Parsed ${rawEntries.length} entries from OFAC.`);

  return rawEntries.map(entry => ({
    id: `OFAC-${entry.uid}`,
    sourceList: 'OFAC',
    type: entry.sdnType === 'Individual' ? 'individual' : 'entity',
    primaryName: extractOfacName(entry),
    aliases: extractOfacAliases(entry),
    program: extractOfacProgram(entry),
    walletAddresses: extractOfacWalletAddresses(entry)
  }));
}

// ---------- UN ----------
// NOTE: field names below are a best-effort based on the UN Consolidated
// List's documented schema. If the diagnostic log below shows different
// tag names, adjust the field references in extractUnName/extractUnAliases
// accordingly - the raw first parsed record is logged for exactly this reason.

function extractUnAliases(entry) {
  const akaList = entry.INDIVIDUAL_ALIAS || entry.ENTITY_ALIAS;
  return toArray(akaList)
    .map(a => a.ALIAS_NAME || a)
    .filter(Boolean);
}

function extractUnName(entry, isIndividual) {
  if (isIndividual) {
    const parts = [entry.FIRST_NAME, entry.SECOND_NAME, entry.THIRD_NAME, entry.FOURTH_NAME]
      .filter(Boolean);
    return parts.length ? parts.join(' ') : 'UNKNOWN';
  }
  return entry.FIRST_NAME || entry.NAME || 'UNKNOWN';
}

async function fetchUnEntries() {
  console.log(`Downloading UN Consolidated List from ${UN_XML_URL} ...`);
  const xml = await downloadXml(UN_XML_URL);
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);

  const root = parsed?.CONSOLIDATED_LIST || parsed?.CONSOLIDATED_LIST_EN || {};
  const individuals = toArray(root?.INDIVIDUALS?.INDIVIDUAL);
  const entities = toArray(root?.ENTITIES?.ENTITY);

  if (individuals.length > 0) {
    console.log('--- UN diagnostic: first parsed individual record ---');
    console.log(JSON.stringify(individuals[0], null, 2).slice(0, 800));
    console.log('--- end diagnostic ---');
  } else {
    console.warn('WARNING: no UN individuals parsed - check root/tag names against the raw XML.');
  }

  console.log(`Parsed ${individuals.length} individuals and ${entities.length} entities from UN.`);

  const individualEntries = individuals.map(entry => ({
    id: `UN-${entry.DATAID || entry.REFERENCE_NUMBER}`,
    sourceList: 'UN',
    type: 'individual',
    primaryName: extractUnName(entry, true),
    aliases: extractUnAliases(entry),
    program: entry.UN_LIST_TYPE || entry.REFERENCE_NUMBER || 'UN-SANCTIONS',
    walletAddresses: []
  }));

  const entityEntries = entities.map(entry => ({
    id: `UN-${entry.DATAID || entry.REFERENCE_NUMBER}`,
    sourceList: 'UN',
    type: 'entity',
    primaryName: extractUnName(entry, false),
    aliases: extractUnAliases(entry),
    program: entry.UN_LIST_TYPE || entry.REFERENCE_NUMBER || 'UN-SANCTIONS',
    walletAddresses: []
  }));

  return [...individualEntries, ...entityEntries];
}

// ---------- Merge & save ----------

async function buildSnapshot() {
  const results = await Promise.allSettled([fetchOfacEntries(), fetchUnEntries()]);

  let entries = [];
  const sourcesUsed = [];

  results.forEach((result, i) => {
    const sourceName = i === 0 ? 'OFAC' : 'UN';
    if (result.status === 'fulfilled') {
      entries = entries.concat(result.value);
      sourcesUsed.push(sourceName);
    } else {
      console.error(`Failed to fetch ${sourceName}: ${result.reason.message}`);
    }
  });

  if (entries.length === 0) {
    throw new Error('All sources failed - refusing to write an empty snapshot.');
  }

  const snapshot = {
    snapshotVersion: `MULTI-SOURCE-${new Date().toISOString()}`,
    generatedAt: new Date().toISOString(),
    sources: sourcesUsed,
    entryCount: entries.length,
    entries
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2));
  console.log(`Wrote ${entries.length} entries (sources: ${sourcesUsed.join(', ')}) to ${OUTPUT_PATH}`);
  return snapshot;
}

if (require.main === module) {
  buildSnapshot()
    .then(s => console.log(`Snapshot refresh complete: ${s.entryCount} entries from ${s.sources.join(', ')}.`))
    .catch(err => {
      console.error('Snapshot refresh failed:', err.message);
      process.exit(1);
    });
}

module.exports = { buildSnapshot };
