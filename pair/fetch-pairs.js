// fetch-pairs-with-decimals.js
const { SuiClient } = require('@mysten/sui/client');
const fs = require('fs');
const chalk = require('chalk');

const MAINNET_RPC = 'https://fullnode.mainnet.sui.io:443';
const FACTORY_ID = '0x81c286135713b4bf2e78c548f5643766b5913dcd27a8e76469f146ab811e922d';

const client = new SuiClient({ url: MAINNET_RPC });

// Cache for token decimals
const tokenDecimalsCache = {};

// Known decimals for common tokens (fallback)
const KNOWN_DECIMALS = {
  '0x2::sui::SUI': 9,
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC': 6,
  '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT': 6,
};

async function getCoinDecimals(coinType) {
  // Check cache first
  if (tokenDecimalsCache[coinType] !== undefined) {
    return tokenDecimalsCache[coinType];
  }

  // Check known decimals
  if (KNOWN_DECIMALS[coinType] !== undefined) {
    tokenDecimalsCache[coinType] = KNOWN_DECIMALS[coinType];
    return KNOWN_DECIMALS[coinType];
  }

  // Fetch from chain
  try {
    const metadata = await client.getCoinMetadata({ coinType });
    if (metadata && metadata.decimals !== null && metadata.decimals !== undefined) {
      tokenDecimalsCache[coinType] = metadata.decimals;
      return metadata.decimals;
    }
  } catch (err) {
    // Silently fail
  }

  // Default to 9 decimals if not found
  console.log(chalk.yellow(`     ⚠️  Could not fetch decimals for ${coinType.split('::').pop()}, defaulting to 9`));
  tokenDecimalsCache[coinType] = 9;
  return 9;
}

function normalizeAmount(rawAmount, decimals) {
  return parseFloat(rawAmount) / Math.pow(10, decimals);
}

async function fetchAllPairs() {
  console.log(chalk.blue.bold('\n╔════════════════════════════════════════════╗'));
  console.log(chalk.blue.bold('║    FETCHING PAIRS WITH TOKEN METADATA     ║'));
  console.log(chalk.blue.bold('╚════════════════════════════════════════════╝\n'));
  
  try {
    console.log(chalk.cyan('📂 Fetching factory object...\n'));
    
    const factoryObj = await client.getObject({
      id: FACTORY_ID,
      options: { showContent: true }
    });
    
    if (!factoryObj.data?.content?.fields) {
      console.error(chalk.red('❌ Could not fetch factory data'));
      return;
    }
    
    const allPairsField = factoryObj.data.content.fields.all_pairs;
    console.log(chalk.green(`✓ Found ${chalk.bold(allPairsField.length)} pairs in factory\n`));
    
    const pairs = [];
    const tokenSet = new Set();
    
    console.log(chalk.cyan('🔄 Fetching pair details and reserves...\n'));
    
    for (let i = 0; i < allPairsField.length; i++) {
      const pairAddr = allPairsField[i];
      process.stdout.write(chalk.gray(`   [${i + 1}/${allPairsField.length}] ${pairAddr.slice(0, 8)}... `));
      
      try {
        const pairObj = await client.getObject({
          id: pairAddr,
          options: { showContent: true, showType: true }
        });
        
        if (!pairObj.data?.content?.fields || !pairObj.data?.type) {
          console.log(chalk.red('✗ No data'));
          continue;
        }
        
        const fields = pairObj.data.content.fields;
        const typeMatch = pairObj.data.type.match(/<(.+)>/);
        
        if (!typeMatch) {
          console.log(chalk.red('✗ Invalid type'));
          continue;
        }
        
        const typeParams = typeMatch[1].split(',').map(t => t.trim());
        
        if (typeParams.length !== 2) {
          console.log(chalk.red('✗ Invalid params'));
          continue;
        }
        
        const token0 = typeParams[0];
        const token1 = typeParams[1];
        
        tokenSet.add(token0);
        tokenSet.add(token1);
        
        const token0Short = token0.split('::').pop();
        const token1Short = token1.split('::').pop();
        
        console.log(chalk.green(`✓ ${token0Short}/${token1Short}`));
        
        pairs.push({
          address: pairAddr,
          token0,
          token1,
          token0_short: token0Short,
          token1_short: token1Short,
          reserve0_raw: fields.reserve0,
          reserve1_raw: fields.reserve1,
          name: fields.name,
          symbol: fields.symbol,
          total_supply: fields.total_supply
        });
        
      } catch (err) {
        console.log(chalk.red(`✗ Error: ${err.message}`));
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(chalk.green.bold(`\n✓ Successfully fetched ${pairs.length} pairs`));
    
    // Now fetch decimals for all unique tokens
    console.log(chalk.cyan.bold(`\n🔍 Fetching token decimals for ${tokenSet.size} unique tokens...\n`));
    
    const tokens = Array.from(tokenSet);
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const tokenShort = token.split('::').pop();
      
      process.stdout.write(chalk.gray(`   [${i + 1}/${tokens.length}] ${tokenShort.padEnd(25)} `));
      
      const decimals = await getCoinDecimals(token);
      console.log(chalk.cyan(`→ ${decimals} decimals`));
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(chalk.green.bold('\n✓ All token decimals fetched'));
    
    // Enrich pairs with decimal info and normalized reserves
    console.log(chalk.cyan.bold('\n📊 Calculating normalized reserves...\n'));
    
    const enrichedPairs = pairs.map(pair => {
      const token0Decimals = tokenDecimalsCache[pair.token0] || 9;
      const token1Decimals = tokenDecimalsCache[pair.token1] || 9;
      
      const reserve0Normalized = normalizeAmount(pair.reserve0_raw, token0Decimals);
      const reserve1Normalized = normalizeAmount(pair.reserve1_raw, token1Decimals);
      
      // Calculate price (token0 in terms of token1)
      const price = reserve0Normalized > 0 ? reserve1Normalized / reserve0Normalized : 0;
      
      console.log(chalk.white(`   ${pair.token0_short}/${pair.token1_short}:`));
      console.log(chalk.gray(`     Reserve0: ${reserve0Normalized.toFixed(2)} ${pair.token0_short} (${token0Decimals} decimals)`));
      console.log(chalk.gray(`     Reserve1: ${reserve1Normalized.toFixed(2)} ${pair.token1_short} (${token1Decimals} decimals)`));
      console.log(chalk.gray(`     Price: 1 ${pair.token0_short} = ${price.toFixed(6)} ${pair.token1_short}\n`));
      
      return {
        ...pair,
        token0_decimals: token0Decimals,
        token1_decimals: token1Decimals,
        reserve0_normalized: reserve0Normalized,
        reserve1_normalized: reserve1Normalized,
        price_token0_to_token1: price
      };
    });
    
    // Save to JSON
    const output = {
      timestamp: new Date().toISOString(),
      factory: FACTORY_ID,
      total_pairs: enrichedPairs.length,
      total_tokens: tokenSet.size,
      token_decimals: tokenDecimalsCache,
      pairs: enrichedPairs
    };
    
    fs.writeFileSync('pairs-with-decimals.json', JSON.stringify(output, null, 2));
    console.log(chalk.green.bold('💾 Saved to pairs-with-decimals.json\n'));
    
    // Print summary
    console.log(chalk.blue.bold('╔════════════════════════════════════════════╗'));
    console.log(chalk.blue.bold('║              SUMMARY                       ║'));
    console.log(chalk.blue.bold('╚════════════════════════════════════════════╝\n'));
    
    console.log(chalk.white(`   Total Pairs:         ${chalk.bold(enrichedPairs.length)}`));
    console.log(chalk.white(`   Unique Tokens:       ${chalk.bold(tokenSet.size)}`));
    console.log(chalk.white(`   Decimals Cached:     ${chalk.bold(Object.keys(tokenDecimalsCache).length)}`));
    console.log();
    
    // Show decimal distribution
    const decimalDist = {};
    Object.values(tokenDecimalsCache).forEach(d => {
      decimalDist[d] = (decimalDist[d] || 0) + 1;
    });
    
    console.log(chalk.cyan('   Decimal Distribution:'));
    Object.entries(decimalDist).sort((a, b) => b[1] - a[1]).forEach(([decimals, count]) => {
      console.log(chalk.gray(`     ${decimals} decimals: ${count} tokens`));
    });
    console.log();
    
    // Show largest pools by TVL (in SUI terms)
    const SUI_TYPE = '0x2::sui::SUI';
    const pairsWithSUI = enrichedPairs.filter(p => p.token0 === SUI_TYPE || p.token1 === SUI_TYPE);
    
    if (pairsWithSUI.length > 0) {
      console.log(chalk.cyan('   🏆 Top 5 Pools by SUI Liquidity:\n'));
      
      pairsWithSUI
        .map(p => ({
          name: `${p.token0_short}/${p.token1_short}`,
          suiAmount: p.token0 === SUI_TYPE ? p.reserve0_normalized : p.reserve1_normalized
        }))
        .sort((a, b) => b.suiAmount - a.suiAmount)
        .slice(0, 5)
        .forEach((pool, idx) => {
          console.log(chalk.white(`     ${idx + 1}. ${pool.name.padEnd(30)} ${pool.suiAmount.toFixed(2)} SUI`));
        });
      console.log();
    }
    
  } catch (error) {
    console.error(chalk.red.bold('\n❌ Error:'), error.message);
    if (error.stack) console.error(chalk.gray(error.stack));
  }
}

fetchAllPairs();