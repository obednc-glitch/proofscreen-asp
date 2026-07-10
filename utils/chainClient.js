const { ethers } = require('ethers');

const PROOF_REGISTRY_ABI = [
  'function anchorProof(bytes32 proofHash) external',
  'function verifyProof(bytes32 proofHash) external view returns (bool anchored, address submitter, uint64 timestamp)',
  'event ProofAnchored(bytes32 indexed proofHash, address indexed submitter, uint64 timestamp)'
];

function getProvider() { return new ethers.JsonRpcProvider(process.env.XLAYER_RPC_URL); }
function getSigner() { return new ethers.Wallet(process.env.SERVICE_PRIVATE_KEY, getProvider()); }
function getContract(withSigner = false) {
  return new ethers.Contract(process.env.PROOF_REGISTRY_ADDRESS, PROOF_REGISTRY_ABI, withSigner ? getSigner() : getProvider());
}

async function anchorReport(report) {
  const reportJson = JSON.stringify(report);
  const hash = ethers.keccak256(ethers.toUtf8Bytes(reportJson));
  const contract = getContract(true);
  const tx = await contract.anchorProof(hash);
  const receipt = await tx.wait();
  return { hash, txHash: receipt.hash, chain: 'x-layer-testnet' };
}

async function verifyReport(hash) {
  const contract = getContract(false);
  const [anchored, submitter, timestamp] = await contract.verifyProof(hash);
  return { anchored, submitter, timestamp: Number(timestamp) };
}

module.exports = { anchorReport, verifyReport };
