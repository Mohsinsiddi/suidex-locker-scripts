// zap-usdc-victory-detailed.js
const { SuiClient } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
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

function logSection(title) {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${title}`);
  console.log('='.repeat(70));
}

function logStep(step, message) {
  console.log(`\n[${step}] ${message}`);
}

function logDetail(message, indent = 1) {
  console.log('  '.repeat(indent) + '→ ' + message);
}

function logSuccess(message) {
  console.log(`  ✅ ${message}`);
}

function logError(message) {
  console.error(`  ❌ ${message}`);
}

async function fetchUSDCCoins(client, address) {
  logStep('FETCH', 'Getting USDC coins from wallet');
  
  try {
    const coins = await client.getCoins({
      owner: address,
      coinType: USDC_TYPE
    });
    
    if (!coins.data || coins.data.length === 0) {
      throw new Error('No USDC coins found');
    }
    
    const totalBalance = coins.data.reduce((sum, coin) => sum + BigInt(coin.balance), 0n);
    
    logSuccess(`Found ${coins.data.length} USDC coin(s)`);
    logDetail(`Total balance: ${Number(totalBalance) / 1e6} USDC`);
    logDetail(`Largest coin: ${coins.data[0].coinObjectId}`);
    logDetail(`Coin balance: ${Number(coins.data[0].balance) / 1e6} USDC`);
    
    return coins.data[0];
  } catch (error) {
    logError(`Failed to fetch USDC coins: ${error.message}`);
    throw error;
  }
}

async function findPair(client, sender) {
  logStep('PAIR', 'Finding VICTORY/USDC pair');
  
  try {
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
        logSuccess(`Pair found: ${pairAddress}`);
        return pairAddress;
      }
    }

    throw new Error('Pair not found');
  } catch (error) {
    logError(`Failed to find pair: ${error.message}`);
    throw error;
  }
}

async function getReserves(client, pairAddress, sender) {
  logStep('RESERVES', 'Fetching pool reserves');
  
  try {
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
      
      logSuccess(`Reserves fetched`);
      logDetail(`Reserve0 (VICTORY): ${Number(reserve0) / 1e6} tokens`);
      logDetail(`Reserve1 (USDC): ${Number(reserve1) / 1e6} USDC`);
      logDetail(`Current rate: 1 USDC = ${Number(reserve0 * 1000000n / reserve1) / 1e6} VICTORY`);
      
      return { reserve0, reserve1 };
    }

    throw new Error('Failed to parse reserves');
  } catch (error) {
    logError(`Failed to fetch reserves: ${error.message}`);
    throw error;
  }
}

async function buildZapTransaction(pairAddress, usdcCoinId, zapAmount, reserves, sender) {
  logStep('BUILD', 'Constructing zap transaction');
  
  try {
    const tx = new Transaction();
    tx.setSender(sender);
    
    const totalUSDC = BigInt(zapAmount);
    const swapAmount = totalUSDC / 2n;
    const lpAmount = totalUSDC - swapAmount;
    
    logDetail(`Total USDC to zap: ${Number(totalUSDC) / 1e6} USDC`);
    logDetail(`Amount for swap: ${Number(swapAmount) / 1e6} USDC`);
    logDetail(`Amount for LP: ${Number(lpAmount) / 1e6} USDC`);
    
    // STEP 1: Split USDC
    logStep('SPLIT', 'Splitting USDC coin');
    logDetail(`Original coin: ${usdcCoinId}`);
    logDetail(`Split amount: ${Number(swapAmount)} (${Number(swapAmount) / 1e6} USDC)`);
    
    const splitResult = tx.splitCoins(
      tx.object(usdcCoinId),
      [Number(swapAmount)]
    );
    
    const coinForSwap = splitResult[0];
    const coinForLP = tx.object(usdcCoinId); // Original coin now has remaining balance
    
    logSuccess(`Coins split`);
    logDetail(`coinForSwap: ${JSON.stringify(coinForSwap)}`, 2);
    logDetail(`coinForLP: Using original coin with remaining balance`, 2);
    
    // STEP 2: Calculate swap
    logStep('CALC', 'Calculating swap amounts');
    
    const amountIn = swapAmount;
    const amountInWithFee = amountIn * 997n;
    const numerator = amountInWithFee * reserves.reserve0;
    const denominator = reserves.reserve1 * 1000n + amountInWithFee;
    const expectedVictory = numerator / denominator;
    const minVictory = (expectedVictory * 90n) / 100n;
    
    logDetail(`Input: ${Number(swapAmount) / 1e6} USDC`);
    logDetail(`Expected output: ${Number(expectedVictory) / 1e6} VICTORY`);
    logDetail(`Min output (10% slippage): ${Number(minVictory) / 1e6} VICTORY`);
    
    // STEP 3: Build swap call
    logStep('SWAP', 'Building swap call');
    logDetail(`Function: swap_exact_tokens1_for_tokens0_composable`);
    logDetail(`Type args: [VICTORY, USDC]`);
    
    try {
      const victoryCoins = tx.moveCall({
        target: `${PACKAGE_ID}::router::swap_exact_tokens1_for_tokens0_composable`,
        typeArguments: [VICTORY_TYPE, USDC_TYPE],
        arguments: [
          tx.object(ROUTER_ID),
          tx.object(FACTORY_ID),
          tx.object(pairAddress),
          coinForSwap,
          tx.pure.u256(minVictory),
          tx.object(CLOCK_ID)
        ]
      });
      
      logSuccess(`Swap call built`);
      logDetail(`victoryCoins result: ${JSON.stringify(victoryCoins)}`, 2);
      
      // STEP 4: Calculate LP amounts
      logStep('LP-CALC', 'Calculating add_liquidity amounts');
      
      const minVictoryLP = (expectedVictory * 90n) / 100n;
      const minUSDCLP = (lpAmount * 90n) / 100n;
      
      logDetail(`VICTORY desired: ${Number(expectedVictory) / 1e6}`);
      logDetail(`VICTORY min: ${Number(minVictoryLP) / 1e6}`);
      logDetail(`USDC desired: ${Number(lpAmount) / 1e6}`);
      logDetail(`USDC min: ${Number(minUSDCLP) / 1e6}`);
      
      // STEP 5: Test pure methods
      logStep('TEST', 'Testing tx.pure methods');
      
      try {
        const testU256 = tx.pure.u256(expectedVictory);
        logSuccess(`tx.pure.u256() works: ${testU256 !== undefined}`);
      } catch (e) {
        logError(`tx.pure.u256() failed: ${e.message}`);
        throw e;
      }
      
      try {
        const testString = tx.pure.string('TEST');
        logSuccess(`tx.pure.string() works: ${testString !== undefined}`);
      } catch (e) {
        logError(`tx.pure.string() failed: ${e.message}`);
        throw e;
      }
      
      try {
        const testU64 = tx.pure.u64(600);
        logSuccess(`tx.pure.u64() works: ${testU64 !== undefined}`);
      } catch (e) {
        logError(`tx.pure.u64() failed: ${e.message}`);
        throw e;
      }
      
      // STEP 6: Build add_liquidity call
      logStep('ADD-LP', 'Building add_liquidity call');
      logDetail(`Function: add_liquidity`);
      logDetail(`Type args: [VICTORY, USDC]`);
      
      const deadline = Math.floor(Date.now() / 1000) + 600;
      
      logDetail('Arguments:', 2);
      logDetail(`[0] router: ${ROUTER_ID}`, 3);
      logDetail(`[1] factory: ${FACTORY_ID}`, 3);
      logDetail(`[2] pair: ${pairAddress}`, 3);
      logDetail(`[3] coin_a (VICTORY): from swap result`, 3);
      logDetail(`[4] coin_b (USDC): original coin`, 3);
      logDetail(`[5] amount_a_desired: ${expectedVictory}`, 3);
      logDetail(`[6] amount_b_desired: ${lpAmount}`, 3);
      logDetail(`[7] amount_a_min: ${minVictoryLP}`, 3);
      logDetail(`[8] amount_b_min: ${minUSDCLP}`, 3);
      logDetail(`[9] token0_name: "VICTORY"`, 3);
      logDetail(`[10] token1_name: "USDC"`, 3);
      logDetail(`[11] deadline: ${deadline}`, 3);
      logDetail(`[12] clock: ${CLOCK_ID}`, 3);
      
      tx.moveCall({
        target: `${PACKAGE_ID}::router::add_liquidity`,
        typeArguments: [VICTORY_TYPE, USDC_TYPE],
        arguments: [
          tx.object(ROUTER_ID),
          tx.object(FACTORY_ID),
          tx.object(pairAddress),
          victoryCoins,
          coinForLP,
          tx.pure.u256(expectedVictory),
          tx.pure.u256(lpAmount),
          tx.pure.u256(minVictoryLP),
          tx.pure.u256(minUSDCLP),
          tx.pure.string('VICTORY'),
          tx.pure.string('USDC'),
          tx.pure.u64(deadline),
          tx.object(CLOCK_ID)
        ]
      });
      
      logSuccess(`add_liquidity call built`);
      
      return tx;
      
    } catch (error) {
      logError(`Failed to build swap call: ${error.message}`);
      throw error;
    }
    
  } catch (error) {
    logError(`Failed to build transaction: ${error.message}`);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    throw error;
  }
}

async function main() {
  logSection('USDC → VICTORY/USDC LP ZAP');
  
  if (!process.env.PRIVATE_KEY) {
    logError('PRIVATE_KEY not found in .env');
    process.exit(1);
  }
  
  const client = new SuiClient({ url: MAINNET_RPC });
  const keypair = getKeypair(process.env.PRIVATE_KEY);
  const address = keypair.getPublicKey().toSuiAddress();
  
  console.log(`\n👤 Wallet: ${address}`);
  
  try {
    // Fetch coins
    const usdcCoin = await fetchUSDCCoins(client, address);
    
    // Find pair
    const pairAddress = await findPair(client, address);
    
    // Get reserves
    const reserves = await getReserves(client, pairAddress, address);
    
    // Build transaction
    const zapAmount = 1_000_000; // 1 USDC
    const tx = await buildZapTransaction(pairAddress, usdcCoin.coinObjectId, zapAmount, reserves, address);
    
    tx.setGasBudget(100000000);
    
    // Dry run
    logStep('DRY-RUN', 'Testing transaction');
    const built = await tx.build({ client });
    const dryRun = await client.dryRunTransactionBlock({
      transactionBlock: built
    });
    
    if (dryRun.effects.status.status !== 'success') {
      logError(`Dry run failed: ${dryRun.effects.status.error}`);
      console.error('\nFull dry run result:');
      console.error(JSON.stringify(dryRun, null, 2));
      process.exit(1);
    }
    
    logSuccess('Dry run passed');
    
    // Execute
    logStep('EXECUTE', 'Submitting transaction');
    console.log('\n⚠️  This will spend ~1 USDC + gas fees');
    
    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: {
        showEffects: true,
        showObjectChanges: true,
        showEvents: true
      }
    });
    
    logSection('SUCCESS');
    
    console.log(`\n📝 Transaction: ${result.digest}`);
    console.log(`🔗 Explorer: https://suiscan.xyz/mainnet/tx/${result.digest}`);
    
    // Show created objects
    console.log('\n📦 Created Objects:');
    result.objectChanges?.filter(obj => obj.type === 'created').forEach(obj => {
      console.log(`  • ${obj.objectType}`);
      console.log(`    ID: ${obj.objectId}`);
    });
    
    // Show LP token
    const lpTokens = result.objectChanges?.filter(
      obj => obj.type === 'created' && obj.objectType?.includes('LPCoin')
    );
    
    if (lpTokens && lpTokens.length > 0) {
      console.log(`\n🎉 LP Token: ${lpTokens[0].objectId}`);
    }
    
    // Show events
    console.log('\n📊 Events:');
    result.events?.forEach((event) => {
      if (event.type.includes('::Swap')) {
        console.log(`  ✓ Swap: ${Number(event.parsedJson.amount1_in) / 1e6} USDC → ${Number(event.parsedJson.amount0_out) / 1e6} VICTORY`);
      } else if (event.type.includes('::LPMint')) {
        console.log(`  ✓ LP Mint:`);
        console.log(`    ${Number(event.parsedJson.amount0) / 1e6} VICTORY`);
        console.log(`    ${Number(event.parsedJson.amount1) / 1e6} USDC`);
        console.log(`    → ${Number(event.parsedJson.liquidity)} LP tokens`);
      }
    });
    
    logSection('COMPLETE');
    
  } catch (error) {
    logSection('ERROR');
    console.error(`\n❌ ${error.message}`);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main().catch(console.error);