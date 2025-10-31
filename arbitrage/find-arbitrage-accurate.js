// arbitrage/cross-dex-final.js
const { SuiClient } = require('@mysten/sui/client');
const fs = require('fs');
const chalk = require('chalk');
const path = require('path');

const MAINNET_RPC = 'https://fullnode.mainnet.sui.io:443';
const client = new SuiClient({ url: MAINNET_RPC });

const Q64 = Math.pow(2, 64);

async function fetchCetusPrice(poolId, expectedPriceRange = [2, 3]) {
  try {
    const poolObj = await client.getObject({
      id: poolId,
      options: { showContent: true, showType: true }
    });
    
    if (!poolObj.data?.content?.fields) return null;
    
    const fields = poolObj.data.content.fields;
    const poolType = poolObj.data.type;
    
    // Extract token types from pool type
    console.log(chalk.gray(`\n   Pool Type: ${poolType.slice(0, 100)}...`));
    
    const sqrtPriceX64 = BigInt(fields.current_sqrt_price);
    const sqrtPriceFloat = Number(sqrtPriceX64) / Q64;
    const priceRaw = sqrtPriceFloat * sqrtPriceFloat;
    
    // For SUI/USDC pool (assuming SUI has 9 decimals, USDC has 6)
    const decimalsA = 9;
    const decimalsB = 6;
    const decimalAdjustment = Math.pow(10, decimalsB - decimalsA);
    let price = priceRaw * decimalAdjustment;
    
    console.log(chalk.gray(`   Raw sqrtPrice: ${fields.current_sqrt_price}`));
    console.log(chalk.gray(`   Calculated price: ${price.toFixed(6)}`));
    
    // Check if price needs to be inverted
    // Expected SUI price is around $2-3
    if (price < expectedPriceRange[0] || price > expectedPriceRange[1]) {
      const invertedPrice = 1 / price;
      console.log(chalk.yellow(`   ⚠️  Price ${price.toFixed(6)} is out of expected range [${expectedPriceRange[0]}, ${expectedPriceRange[1]}]`));
      console.log(chalk.yellow(`   🔄 Inverting: 1 / ${price.toFixed(6)} = ${invertedPrice.toFixed(6)}`));
      
      if (invertedPrice >= expectedPriceRange[0] && invertedPrice <= expectedPriceRange[1]) {
        console.log(chalk.green(`   ✓ Inverted price is within expected range!`));
        price = invertedPrice;
      }
    } else {
      console.log(chalk.green(`   ✓ Price is within expected range`));
    }
    
    return {
      dex: 'Cetus',
      price,
      liquidity: fields.liquidity,
      sqrtPrice: fields.current_sqrt_price,
      poolId
    };
  } catch (err) {
    console.error(chalk.red('   Error:'), err.message);
    return null;
  }
}

async function fetchSuitrumpPrice(pair, suitrumpData) {
  const pairObj = suitrumpData.pairs.find(p => 
    `${p.token0_short}/${p.token1_short}` === pair ||
    `${p.token1_short}/${p.token0_short}` === pair
  );
  
  if (!pairObj) return null;
  
  try {
    const obj = await client.getObject({
      id: pairObj.address,
      options: { showContent: true }
    });
    
    const fields = obj.data.content.fields;
    const reserve0 = parseFloat(fields.reserve0);
    const reserve1 = parseFloat(fields.reserve1);
    
    const priceRaw = reserve1 / reserve0;
    const dec0 = pairObj.token0_decimals;
    const dec1 = pairObj.token1_decimals;
    const price = priceRaw / Math.pow(10, dec1 - dec0);
    
    return {
      dex: 'SuitrumpDEX',
      price,
      reserve0Normalized: reserve0 / Math.pow(10, dec0),
      reserve1Normalized: reserve1 / Math.pow(10, dec1),
      pairAddress: pairObj.address
    };
  } catch (err) {
    return null;
  }
}

async function main() {
  console.log(chalk.magenta.bold('\n╔════════════════════════════════════════════════════════════╗'));
  console.log(chalk.magenta.bold('║                                                            ║'));
  console.log(chalk.magenta.bold('║        🎯 CROSS-DEX ARBITRAGE (CORRECTED PRICING) 🎯      ║'));
  console.log(chalk.magenta.bold('║                                                            ║'));
  console.log(chalk.magenta.bold('╚════════════════════════════════════════════════════════════╝\n'));
  
  try {
    const dataPath = path.join(__dirname, '..', 'pair', 'pairs-with-decimals.json');
    const suitrumpData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    
    console.log(chalk.cyan.bold('📊 FETCHING SUI/USDC PRICES FROM MULTIPLE DEXES...\n'));
    
    // Fetch from SuitrumpDEX
    console.log(chalk.yellow('1️⃣  SuitrumpDEX:'));
    const suitrumpPrice = await fetchSuitrumpPrice('SUI/USDC', suitrumpData);
    
    if (suitrumpPrice) {
      console.log(chalk.white(`   ✓ Price: 1 SUI = $${suitrumpPrice.price.toFixed(4)} USDC`));
      console.log(chalk.gray(`     Liquidity: ${suitrumpPrice.reserve0Normalized.toFixed(2)} SUI / ${suitrumpPrice.reserve1Normalized.toFixed(2)} USDC`));
    }
    
    // Fetch from Cetus
    console.log(chalk.yellow('\n2️⃣  Cetus:'));
    const CETUS_SUI_USDC = '0xcf994611fd4c48e277ce3ffd4d4364c914af2c3cbb05f7bf6facd371de688630';
    const cetusPrice = await fetchCetusPrice(CETUS_SUI_USDC, [2, 3]);
    
    if (cetusPrice) {
      console.log(chalk.white(`   ✓ Final Price: 1 SUI = $${cetusPrice.price.toFixed(4)} USDC`));
    }
    
    // Compare prices
    if (suitrumpPrice && cetusPrice) {
      console.log(chalk.blue.bold('\n╔════════════════════════════════════════════════════════════╗'));
      console.log(chalk.blue.bold('║                    ARBITRAGE ANALYSIS                      ║'));
      console.log(chalk.blue.bold('╚════════════════════════════════════════════════════════════╝\n'));
      
      const priceDiff = Math.abs(cetusPrice.price - suitrumpPrice.price);
      const priceDiffPercent = (priceDiff / Math.min(cetusPrice.price, suitrumpPrice.price)) * 100;
      
      console.log(chalk.white(`   SuitrumpDEX: $${suitrumpPrice.price.toFixed(6)}`));
      console.log(chalk.white(`   Cetus:       $${cetusPrice.price.toFixed(6)}`));
      console.log(chalk.cyan(`   Difference:  $${priceDiff.toFixed(6)} (${priceDiffPercent.toFixed(4)}%)\n`));
      
      // Need at least 0.3% profit to cover gas + fees
      const MIN_PROFIT_PERCENT = 0.3;
      
      if (priceDiffPercent > MIN_PROFIT_PERCENT) {
        console.log(chalk.green.bold('✅ ARBITRAGE OPPORTUNITY DETECTED!\n'));
        
        const buyDex = cetusPrice.price < suitrumpPrice.price ? 'Cetus' : 'SuitrumpDEX';
        const sellDex = cetusPrice.price < suitrumpPrice.price ? 'SuitrumpDEX' : 'Cetus';
        const buyPrice = Math.min(cetusPrice.price, suitrumpPrice.price);
        const sellPrice = Math.max(cetusPrice.price, suitrumpPrice.price);
        
        console.log(chalk.yellow(`   Strategy: BUY on ${buyDex} → SELL on ${sellDex}\n`));
        
        // Calculate profits for different capital amounts
        const capitalAmounts = [100, 500, 1000];
        
        console.log(chalk.cyan.bold('   💰 PROFIT SCENARIOS:\n'));
        
        capitalAmounts.forEach(capital => {
          const suiAmount = capital / buyPrice;
          const sellValue = suiAmount * sellPrice;
          const grossProfit = sellValue - capital;
          
          // Estimate costs
          const tradingFees = capital * 0.003 * 2; // 0.3% fee x 2 trades
          const gasCost = 0.02; // ~0.02 SUI gas = ~$0.05
          const netProfit = grossProfit - tradingFees - gasCost;
          const netProfitPercent = (netProfit / capital) * 100;
          
          if (netProfit > 0) {
            console.log(chalk.white(`   💵 Capital: $${capital} USDC`));
            console.log(chalk.gray(`      1. Buy ${suiAmount.toFixed(2)} SUI on ${buyDex} at $${buyPrice.toFixed(4)}`));
            console.log(chalk.gray(`      2. Sell ${suiAmount.toFixed(2)} SUI on ${sellDex} at $${sellPrice.toFixed(4)}`));
            console.log(chalk.gray(`      3. Gross Profit: $${grossProfit.toFixed(2)}`));
            console.log(chalk.gray(`      4. Trading Fees: -$${tradingFees.toFixed(2)}`));
            console.log(chalk.gray(`      5. Gas Cost: -$${gasCost.toFixed(2)}`));
            console.log(chalk.green.bold(`      → Net Profit: $${netProfit.toFixed(2)} (${netProfitPercent.toFixed(2)}% ROI)\n`));
          } else {
            console.log(chalk.red(`   💵 Capital: $${capital} - Not profitable after fees\n`));
          }
        });
        
        console.log(chalk.blue.bold('   📝 EXECUTION STEPS:\n'));
        console.log(chalk.white(`      1. Flash loan ${1000} USDC from DeepBook`));
        console.log(chalk.white(`      2. Swap USDC → SUI on ${buyDex}`));
        console.log(chalk.white(`      3. Swap SUI → USDC on ${sellDex}`));
        console.log(chalk.white(`      4. Repay flash loan + keep profit\n`));
        
      } else {
        console.log(chalk.yellow(`⚠️  Price difference (${priceDiffPercent.toFixed(4)}%) is too small\n`));
        console.log(chalk.gray(`   Need at least ${MIN_PROFIT_PERCENT}% to cover:`));
        console.log(chalk.gray(`   • Trading fees: 0.6% (0.3% x 2 trades)`));
        console.log(chalk.gray(`   • Gas costs: ~$0.05`));
        console.log(chalk.gray(`   • Flash loan fees (if applicable)\n`));
        console.log(chalk.cyan(`   💡 Recommendation: Wait for larger price discrepancies\n`));
      }
    }
    
  } catch (error) {
    console.error(chalk.red.bold('❌ ERROR:'), error.message);
    console.error(chalk.gray(error.stack));
  }
}

main();