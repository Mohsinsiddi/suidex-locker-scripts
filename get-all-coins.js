// check-all-coins.js
const { SuiClient } = require('@mysten/sui/client');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const fs = require('fs');
require('dotenv').config();

const MAINNET_RPC = 'https://fullnode.mainnet.sui.io:443';

// Coin types to check
const COIN_TYPES = {
  SUI: '0x2::sui::SUI',
  USDC: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC', // Native USDC
  // WORMHOLE_USDC: '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN',
};

// Coin decimals
const DECIMALS = {
  SUI: 9,
  USDC: 6,
  WORMHOLE_USDC: 6,
};

// Get keypair from private key
function getKeypair(privateKey) {
  try {
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

// Get coins for a specific type
async function getCoinsForType(client, address, coinName, coinType, decimals) {
  try {
    // Get balance
    const balance = await client.getBalance({
      owner: address,
      coinType: coinType
    });

    const totalFormatted = Number(balance.totalBalance) / Math.pow(10, decimals);

    // Get all coin objects
    const coins = await client.getCoins({
      owner: address,
      coinType: coinType
    });

    return {
      coinName,
      coinType,
      decimals,
      totalBalance: balance.totalBalance,
      totalBalanceFormatted: totalFormatted.toFixed(decimals),
      coinCount: coins.data.length,
      coins: coins.data.map((coin, i) => ({
        index: i + 1,
        objectId: coin.coinObjectId,
        balance: coin.balance,
        balanceFormatted: (Number(coin.balance) / Math.pow(10, decimals)).toFixed(decimals),
        digest: coin.digest,
        version: coin.version
      }))
    };
  } catch (error) {
    console.error(`   ⚠️  Error fetching ${coinName}:`, error.message);
    return {
      coinName,
      coinType,
      decimals,
      totalBalance: '0',
      totalBalanceFormatted: '0',
      coinCount: 0,
      coins: [],
      error: error.message
    };
  }
}

// Main function
async function checkAllCoins() {
  console.log('🔍 Checking all coins on mainnet...\n');

  if (!process.env.PRIVATE_KEY) {
    console.error('❌ PRIVATE_KEY not found in .env');
    process.exit(1);
  }

  const client = new SuiClient({ url: MAINNET_RPC });
  const keypair = getKeypair(process.env.PRIVATE_KEY);
  const address = keypair.getPublicKey().toSuiAddress();

  console.log('👤 Address:', address);
  console.log('═'.repeat(80));
  console.log('');

  const allCoinsData = {
    timestamp: new Date().toISOString(),
    address: address,
    coins: {}
  };

  // Fetch all coin types
  for (const [coinName, coinType] of Object.entries(COIN_TYPES)) {
    console.log(`💰 Checking ${coinName}...`);
    
    const coinData = await getCoinsForType(
      client,
      address,
      coinName,
      coinType,
      DECIMALS[coinName]
    );

    allCoinsData.coins[coinName] = coinData;

    if (coinData.error) {
      console.log(`   ⚠️  Error: ${coinData.error}\n`);
      continue;
    }

    console.log(`   Total Balance: ${coinData.totalBalanceFormatted} ${coinName}`);
    console.log(`   Coin Objects: ${coinData.coinCount}`);

    if (coinData.coinCount > 0) {
      console.log('');
      coinData.coins.forEach(coin => {
        console.log(`   Coin #${coin.index}:`);
        console.log(`     ID: ${coin.objectId}`);
        console.log(`     Balance: ${coin.balanceFormatted} ${coinName}`);
      });
    }
    console.log('');
  }

  console.log('═'.repeat(80));

  // Save to JSON
  fs.writeFileSync('all-coins.json', JSON.stringify(allCoinsData, null, 2));
  console.log('✅ Saved to all-coins.json');

  // Also save separate files for each coin type
  for (const [coinName, coinData] of Object.entries(allCoinsData.coins)) {
    const filename = `${coinName.toLowerCase()}-coins.json`;
    fs.writeFileSync(filename, JSON.stringify({
      timestamp: allCoinsData.timestamp,
      address: allCoinsData.address,
      ...coinData
    }, null, 2));
  }
  console.log('✅ Saved individual coin files');
}

checkAllCoins().catch(console.error);