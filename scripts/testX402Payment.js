const { ethers } = require('ethers');

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const PAYTO = process.env.X402_PAYTO_ADDRESS || '0xd168318cb484337da6a64ba042bb50a8779ba03b';

const DOMAIN = {
  name: 'USDT0',
  version: '1',
  chainId: 196,
  verifyingContract: '0x779ded0c9e1022225f8e0630b35a9b54be713736'
};

const TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' }
  ]
};

async function main() {
  const wallet = ethers.Wallet.createRandom();
  const now = Math.floor(Date.now() / 1000);

  const authorization = {
    from: wallet.address,
    to: PAYTO,
    value: '0',
    validAfter: '0',
    validBefore: String(now + 300),
    nonce: ethers.hexlify(ethers.randomBytes(32))
  };

  const signature = await wallet.signTypedData(DOMAIN, TYPES, authorization);

  const paymentPayload = {
    x402Version: 1,
    scheme: 'exact',
    network: 'eip155:196',
    payload: { authorization, signature }
  };

  const xPayment = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

  console.log(`Testing against ${BASE_URL}/v1/screen ...`);
  console.log(`Signer address: ${wallet.address}`);

  const url = `${BASE_URL}/v1/screen?wallet_address=0x0000000000000000000000000000000000dead`;
  const res = await fetch(url, {
    headers: { 'X-PAYMENT': xPayment }
  });

  console.log(`Status: ${res.status}`);
  const paymentResponseHeader = res.headers.get('x-payment-response');
  if (paymentResponseHeader) {
    console.log('X-PAYMENT-RESPONSE:', Buffer.from(paymentResponseHeader, 'base64').toString('utf8'));
  }
  const body = await res.json();
  console.log('Body:', JSON.stringify(body, null, 2));
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
