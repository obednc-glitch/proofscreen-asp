const https = require('https');
const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const SDN_XML_URL = 'https://www.treasury.gov/ofac/downloads/sdn.xml';
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'sdn-snapshot.json');

function downloadXml(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ProofScreenASP/1.0)'
      }
    };
    https.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadXml(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download SDN list: HTTP ${res.statusCode}`));
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

function extractAliases(sdnEntry) {
  const akaList = sdnEntry.akaList && sdnEntry.akaList.aka;
  return toArray(akaList)
    .map(aka => {
      const parts = [aka.firstName, aka.lastName].filter(Boolean);
      return parts.length ? parts.join(' ') : (aka.uid || null);
    })
    .filter(Boolean);
}

function extractWalletAddresses(sdnEntry) {
  const idList = sdnEntry.idList && sdnEntry.idList.id;
  return toArray(idList)
    .filter(id => id.idType && /digital currency address/i.test(id.idType))
    .map(id => id.idNumber)
    .filter(Boolean);
}

function extractPrimaryName(sdnEntry) {
  if (sdnEntry.lastName && sdnEntry.firstName) {
    return `${sdnEntry.firstName} ${sdnEntry.lastName}`;
  }
  return sdnEntry.lastName || sdnEntry.firstName || 'UNKNOWN';
}

function extractProgram(sdnEntry) {
  const programList = sdnEntry.programList && sdnEntry.programList.program;
  const programs = toArray(programList);
  return programs.length ? programs.join(', ') : 'UNSPECIFIED';
}

async function buildSnapshot() {
  console.log(`Downloading full SDN list from ${SDN_XML_URL} ...`);
  const xml = await downloadXml(SDN_XML_URL);

  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);

  const rawEntries = toArray(parsed?.sdnList?.sdnEntry);
  console.log(`Parsed ${rawEntries.length} entries from official SDN list.`);

  const entries = rawEntries.map(entry => ({
    id: `SDN-${entry.uid}`,
    type: entry.sdnType === 'Individual' ? 'individual' : 'entity',
    primaryName: extractPrimaryName(entry),
    aliases: extractAliases(entry),
    program: extractProgram(entry),
    walletAddresses: extractWalletAddresses(entry)
  }));

  const snapshot = {
    snapshotVersion: `OFAC-SDN-${new Date().toISOString()}`,
    generatedAt: new Date().toISOString(),
    source: SDN_XML_URL,
    entryCount: entries.length,
    entries
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2));
  console.log(`Wrote ${entries.length} entries to ${OUTPUT_PATH}`);
  return snapshot;
}

if (require.main === module) {
  buildSnapshot()
    .then(s => console.log(`Snapshot refresh complete: ${s.entryCount} entries.`))
    .catch(err => {
      console.error('Snapshot refresh failed:', err.message);
      process.exit(1);
    });
}

module.exports = { buildSnapshot };
