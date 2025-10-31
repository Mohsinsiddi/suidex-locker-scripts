// check-coins.js
const { SuiClient } = require('@mysten/sui/client');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const fs = require('fs');
require('dotenv').config();

const MAINNET_RPC = 'https://fullnode.mainnet.sui.io:443';

// Get keypair from private key
function getKeypair(privateKey) {
  try {
    // Use the built-in decoder for Sui private keys (handles suiprivkey1... format)
    const { schema, secretKey } = decodeSuiPrivateKey(privateKey);
    
    if (schema === 'ED25519') {
      return Ed25519Keypair.fromSecretKey(secretKey);
    } else {
      throw new Error(`Unsupported key scheme: ${schema}`);
    }
  } catch (e) {
    console.error('❌ Error decoding private key:', e.message);
    console.log('💡 Make sure your private key is in the format: suiprivkey1...');
    process.exit(1);
  }
}

// Main function
async function checkCoins() {
  console.log('🔍 Checking SUI coins on mainnet...\n');

  if (!process.env.PRIVATE_KEY) {
    console.error('❌ PRIVATE_KEY not found in .env');
    process.exit(1);
  }

  const client = new SuiClient({ url: MAINNET_RPC });
  const keypair = getKeypair(process.env.PRIVATE_KEY);
  const address = keypair.getPublicKey().toSuiAddress();

  console.log('👤 Address:', address);

  // Get balance
  const balance = await client.getBalance({
    owner: address,
    coinType: '0x2::sui::SUI'
  });

  const totalSui = Number(balance.totalBalance) / 1e9;
  console.log('💰 Total Balance:', totalSui.toFixed(9), 'SUI\n');

  // Get all coin objects
  const coins = await client.getCoins({
    owner: address,
    coinType: '0x2::sui::SUI'
  });

  console.log('🪙 Found', coins.data.length, 'coin objects\n');

  // Format data
  const coinData = {
    timestamp: new Date().toISOString(),
    address: address,
    totalBalance: balance.totalBalance,
    totalBalanceSUI: totalSui.toFixed(9),
    coinCount: coins.data.length,
    coins: coins.data.map((coin, i) => ({
      index: i + 1,
      objectId: coin.coinObjectId,
      balance: coin.balance,
      balanceSUI: (Number(coin.balance) / 1e9).toFixed(9),
      digest: coin.digest,
      version: coin.version
    }))
  };

  // Display coins
  coinData.coins.forEach(coin => {
    console.log(`Coin #${coin.index}:`);
    console.log(`  ID: ${coin.objectId}`);
    console.log(`  Balance: ${coin.balanceSUI} SUI`);
    console.log('');
  });

  // Save to JSON
  fs.writeFileSync('sui-coins.json', JSON.stringify(coinData, null, 2));
  console.log('✅ Saved to sui-coins.json');
}

checkCoins().catch(console.error);