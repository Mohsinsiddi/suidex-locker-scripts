// swap-usdc-victory.js
const { SuiClient } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

const MAINNET_RPC = 'https://fullnode.mainnet.sui.io:443';

const PACKAGE_ID = '0xbfac5e1c6bf6ef29b12f7723857695fd2f4da9a11a7d88162c15e9124c243a4a';
const ROUTER_ID = '0x9cdbbd092634efdc0e7033dc1c49d9ea5fc9bc5969ba708f55e05b6fcac12177';
const FACTORY_ID = '0x81c286135713b4bf2e78c548f5643766b5913dcd27a8e76469f146ab811e922d';
const CLOCK_ID = '0x6';

const VICTORY_TYPE = `${PACKAGE_ID}::victory_token::VICTORY_TOKEN`;
const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

function getKeypair(privateKey) {
  const { secretKey } = decodeSuiPrivateKey(privateKey);
  return Ed25519Keypair.fromSecretKey(secretKey);
}

async function findPair(client, sender) {
  console.log('🔍 Finding VICTORY/USDC pair...');
  
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::factory::get_pair`,
    typeArguments: [VICTORY_TYPE, USDC_TYPE],
    arguments: [tx.object(FACTORY_ID)]
  });

  const result = await client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender
  });

  if (result.results?.[0]?.returnValues?.[0]) {
    const bytes = result.results[0].returnValues[0][0];
    if (bytes && bytes.length > 1 && bytes[0] === 1) {
      const addressBytes = bytes.slice(1, 33);
      const pairAddress = '0x' + Array.from(addressBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      console.log('✅ Pair found:', pairAddress);
      return pairAddress;
    }
  }

  throw new Error('❌ Pair not found');
}

async function getReserves(client, pairAddress, sender) {
  console.log('📊 Fetching reserves...');
  
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::pair::get_reserves`,
    typeArguments: [VICTORY_TYPE, USDC_TYPE],
    arguments: [tx.object(pairAddress)]
  });

  const result = await client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender
  });

  if (result.results?.[0]?.returnValues) {
    const returns = result.results[0].returnValues;
    
    const reserve0Bytes = returns[0][0];
    const reserve1Bytes = returns[1][0];
    
    const reserve0 = BigInt('0x' + Array.from(reserve0Bytes).reverse().map(b => b.toString(16).padStart(2, '0')).join(''));
    const reserve1 = BigInt('0x' + Array.from(reserve1Bytes).reverse().map(b => b.toString(16).padStart(2, '0')).join(''));
    
    console.log(`   Reserve0 (VICTORY): ${Number(reserve0) / 1e6} tokens`);
    console.log(`   Reserve1 (USDC): ${Number(reserve1) / 1e6} USDC`);
    console.log(`   Rate: 1 USDC = ${Number(reserve0 * 1000000n / reserve1) / 1e6} VICTORY\n`);
    
    return { reserve0, reserve1 };
  }

  throw new Error('❌ Failed to fetch reserves');
}

async function buildSwapTransaction(pairAddress, usdcCoinId, swapAmount, reserves, sender) {
  console.log('🔨 Building swap transaction...');
  console.log(`   Swapping: ${Number(swapAmount) / 1e6} USDC → VICTORY\n`);
  
  const tx = new Transaction();
  tx.setSender(sender); // SET SENDER
  
  // Split the amount we want to swap
  const [coinToSwap] = tx.splitCoins(
    tx.object(usdcCoinId),
    [swapAmount]
  );
  
  // Calculate expected output with 0.3% fee
  const amountIn = BigInt(swapAmount);
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserves.reserve0;
  const denominator = reserves.reserve1 * 1000n + amountInWithFee;
  const expectedVictory = numerator / denominator;
  const minVictory = (expectedVictory * 90n) / 100n; // 10% slippage
  
  console.log(`   Expected output: ${Number(expectedVictory) / 1e6} VICTORY`);
  console.log(`   Min output (10% slippage): ${Number(minVictory) / 1e6} VICTORY`);
  
  // Use COMPOSABLE function
  const victoryCoins = tx.moveCall({
    target: `${PACKAGE_ID}::router::swap_exact_tokens1_for_tokens0_composable`,
    typeArguments: [VICTORY_TYPE, USDC_TYPE],
    arguments: [
      tx.object(ROUTER_ID),
      tx.object(FACTORY_ID),
      tx.object(pairAddress),
      coinToSwap,
      tx.pure.u256(minVictory),
      tx.object(CLOCK_ID)
    ]
  });
  
  // Transfer VICTORY to sender
  tx.transferObjects([victoryCoins], sender);
  
  return tx;
}

async function main() {
  console.log('🚀 Simple USDC → VICTORY Swap (Composable)\n');
  
  if (!process.env.PRIVATE_KEY) {
    console.error('❌ PRIVATE_KEY not found');
    process.exit(1);
  }
  
  if (!fs.existsSync('all-coins.json')) {
    console.error('❌ all-coins.json not found');
    process.exit(1);
  }
  
  const coinData = JSON.parse(fs.readFileSync('all-coins.json', 'utf8'));
  const usdcCoins = coinData.coins.USDC?.coins;
  
  if (!usdcCoins || usdcCoins.length === 0) {
    console.error('❌ No USDC coins found');
    process.exit(1);
  }
  
  const usdcCoin = usdcCoins[0];
  console.log(`💰 USDC Coin: ${usdcCoin.objectId}`);
  console.log(`   Balance: ${usdcCoin.balanceFormatted} USDC\n`);
  
  const client = new SuiClient({ url: MAINNET_RPC });
  const keypair = getKeypair(process.env.PRIVATE_KEY);
  const address = keypair.getPublicKey().toSuiAddress();
  
  console.log(`👤 Address: ${address}\n`);
  
  try {
    const pairAddress = await findPair(client, address);
    const reserves = await getReserves(client, pairAddress, address);
    
    // Swap 0.1 USDC = 100,000 (6 decimals)
    const swapAmount = 100_000;
    const tx = await buildSwapTransaction(pairAddress, usdcCoin.objectId, swapAmount, reserves, address);
    
    tx.setGasBudget(50000000); // 0.05 SUI
    
    console.log('\n🧪 Running dry run...');
    const built = await tx.build({ client });
    const dryRun = await client.dryRunTransactionBlock({
      transactionBlock: built
    });
    
    console.log('   Status:', dryRun.effects.status.status);
    
    if (dryRun.effects.status.status !== 'success') {
      console.error('❌ Dry run failed:', dryRun.effects.status.error);
      process.exit(1);
    }
    
    console.log('✅ Dry run passed\n');
    console.log('🔐 Executing transaction...');
    
    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: {
        showEffects: true,
        showObjectChanges: true,
        showEvents: true
      }
    });
    
    console.log('\n✅ SWAP SUCCESSFUL!');
    console.log(`   Digest: ${result.digest}`);
    console.log(`   https://suiscan.xyz/mainnet/tx/${result.digest}`);
    
    // Find VICTORY tokens received
    const created = result.objectChanges?.filter(
      obj => obj.type === 'created' && obj.objectType?.includes('victory_token::VICTORY_TOKEN')
    );
    
    if (created && created.length > 0) {
      console.log(`\n🎉 VICTORY received: ${created[0].objectId}`);
    }
    
    // Show swap event
    const swapEvent = result.events?.find(e => e.type.includes('::Swap'));
    if (swapEvent) {
      console.log('\n📊 Swap details:');
      console.log(`   USDC in: ${Number(swapEvent.parsedJson.amount1_in) / 1e6}`);
      console.log(`   VICTORY out: ${Number(swapEvent.parsedJson.amount0_out) / 1e6}`);
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack);
    }
    process.exit(1);
  }
}

main().catch(console.error);