// find-arbitrage-v2.js
const { SuiClient } = require('@mysten/sui/client');
const fs = require('fs');
const chalk = require('chalk');

const MAINNET_RPC = 'https://fullnode.mainnet.sui.io:443';
const client = new SuiClient({ url: MAINNET_RPC });

// Fee per swap: 0.3% = 0.997 multiplier
const FEE_MULTIPLIER = 0.997;

// Maximum % of pool liquidity to use (for safety)
const MAX_POOL_USAGE_PERCENT = 5; // Don't use more than 5% of any pool

// Test different trade sizes (will be filtered based on liquidity)
const BASE_TEST_AMOUNTS = [100, 500, 1000, 5000, 10000, 50000, 100000];

function formatNumber(num) {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
}

function formatPercent(num) {
  const color = num >= 5 ? chalk.green.bold :
                num >= 1 ? chalk.green :
                num >= 0.1 ? chalk.yellow :
                num > 0 ? chalk.cyan :
                chalk.red;
  return color(`${num >= 0 ? '+' : ''}${num.toFixed(4)}%`);
}

function formatPoolUsage(percent) {
  const color = percent >= 10 ? chalk.red.bold :
                percent >= 5 ? chalk.red :
                percent >= 2 ? chalk.yellow :
                chalk.green;
  return color(`${percent.toFixed(2)}%`);
}

async function fetchRealTimeReserves(pairAddress) {
  try {
    const pairObj = await client.getObject({
      id: pairAddress,
      options: { showContent: true }
    });
    
    if (!pairObj.data?.content?.fields) {
      return null;
    }
    
    const fields = pairObj.data.content.fields;
    return {
      reserve0: fields.reserve0,
      reserve1: fields.reserve1
    };
  } catch (err) {
    return null;
  }
}

function calculatePrice(reserve0, reserve1) {
  if (reserve0 === '0' || reserve0 === 0) return 0;
  return parseFloat(reserve1) / parseFloat(reserve0);
}

function calculateAmountOut(amountIn, reserveIn, reserveOut) {
  // Uniswap V2 formula: amountOut = (amountIn * 0.997 * reserveOut) / (reserveIn + amountIn * 0.997)
  const amountInWithFee = amountIn * FEE_MULTIPLIER;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn + amountInWithFee;
  return numerator / denominator;
}

function calculatePriceImpact(amountIn, reserveIn, reserveOut) {
  // Price before trade
  const priceBefore = reserveOut / reserveIn;
  
  // Calculate amount out
  const amountInWithFee = amountIn * FEE_MULTIPLIER;
  const amountOut = (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee);
  
  // Price after trade
  const newReserveIn = reserveIn + amountIn;
  const newReserveOut = reserveOut - amountOut;
  const priceAfter = newReserveOut / newReserveIn;
  
  // Impact as percentage
  const impact = ((priceAfter - priceBefore) / priceBefore) * 100;
  
  // Pool usage percentage
  const poolUsageIn = (amountIn / reserveIn) * 100;
  const poolUsageOut = (amountOut / reserveOut) * 100;
  
  return {
    impact: Math.abs(impact),
    priceBefore,
    priceAfter,
    amountOut,
    newReserveIn,
    newReserveOut,
    poolUsageIn,
    poolUsageOut,
    maxPoolUsage: Math.max(poolUsageIn, poolUsageOut)
  };
}

function simulateArbitragePath(tokenA, tokenB, tokenC, graph, startAmount) {
  const edgeAB = graph[tokenA][tokenB];
  const edgeBC = graph[tokenB][tokenC];
  const edgeCA = graph[tokenC][tokenA];
  
  // Step 1: A -> B
  const step1 = calculatePriceImpact(startAmount, edgeAB.reserveIn, edgeAB.reserveOut);
  const amountB = step1.amountOut;
  
  // Step 2: B -> C
  const step2 = calculatePriceImpact(amountB, edgeBC.reserveIn, edgeBC.reserveOut);
  const amountC = step2.amountOut;
  
  // Step 3: C -> A
  const step3 = calculatePriceImpact(amountC, edgeCA.reserveIn, edgeCA.reserveOut);
  const finalAmount = step3.amountOut;
  
  const profit = finalAmount - startAmount;
  const profitPercent = (profit / startAmount) * 100;
  const totalPriceImpact = step1.impact + step2.impact + step3.impact;
  const maxPoolUsage = Math.max(step1.maxPoolUsage, step2.maxPoolUsage, step3.maxPoolUsage);
  
  // Calculate liquidity risk score (0-100, higher is riskier)
  let riskScore = 0;
  riskScore += maxPoolUsage > 10 ? 40 : maxPoolUsage > 5 ? 20 : maxPoolUsage > 2 ? 10 : 0;
  riskScore += totalPriceImpact > 10 ? 40 : totalPriceImpact > 5 ? 20 : totalPriceImpact > 2 ? 10 : 0;
  riskScore += Math.min(...[edgeAB.reserveIn, edgeAB.reserveOut, edgeBC.reserveIn, edgeBC.reserveOut, edgeCA.reserveIn, edgeCA.reserveOut]) < 1000000 ? 20 : 0;
  
  return {
    startAmount,
    finalAmount,
    profit,
    profitPercent,
    totalPriceImpact,
    maxPoolUsage,
    riskScore,
    isExecutable: maxPoolUsage <= MAX_POOL_USAGE_PERCENT && totalPriceImpact < 20,
    steps: [
      {
        from: tokenA,
        to: tokenB,
        amountIn: startAmount,
        amountOut: amountB,
        priceImpact: step1.impact,
        priceBefore: step1.priceBefore,
        priceAfter: step1.priceAfter,
        reserveInBefore: edgeAB.reserveIn,
        reserveOutBefore: edgeAB.reserveOut,
        reserveInAfter: step1.newReserveIn,
        reserveOutAfter: step1.newReserveOut,
        poolUsageIn: step1.poolUsageIn,
        poolUsageOut: step1.poolUsageOut,
        pair: edgeAB.pair,
        pairName: `${edgeAB.token0_short}/${edgeAB.token1_short}`
      },
      {
        from: tokenB,
        to: tokenC,
        amountIn: amountB,
        amountOut: amountC,
        priceImpact: step2.impact,
        priceBefore: step2.priceBefore,
        priceAfter: step2.priceAfter,
        reserveInBefore: edgeBC.reserveIn,
        reserveOutBefore: edgeBC.reserveOut,
        reserveInAfter: step2.newReserveIn,
        reserveOutAfter: step2.newReserveOut,
        poolUsageIn: step2.poolUsageIn,
        poolUsageOut: step2.poolUsageOut,
        pair: edgeBC.pair,
        pairName: `${edgeBC.token0_short}/${edgeBC.token1_short}`
      },
      {
        from: tokenC,
        to: tokenA,
        amountIn: amountC,
        amountOut: finalAmount,
        priceImpact: step3.impact,
        priceBefore: step3.priceBefore,
        priceAfter: step3.priceAfter,
        reserveInBefore: edgeCA.reserveIn,
        reserveOutBefore: edgeCA.reserveOut,
        reserveInAfter: step3.newReserveIn,
        reserveOutAfter: step3.newReserveOut,
        poolUsageIn: step3.poolUsageIn,
        poolUsageOut: step3.poolUsageOut,
        pair: edgeCA.pair,
        pairName: `${edgeCA.token0_short}/${edgeCA.token1_short}`
      }
    ]
  };
}

function findOptimalAmount(tokenA, tokenB, tokenC, graph) {
  const edgeAB = graph[tokenA][tokenB];
  const edgeBC = graph[tokenB][tokenC];
  const edgeCA = graph[tokenC][tokenA];
  
  // Calculate maximum safe trade size based on liquidity
  const minReserve = Math.min(
    edgeAB.reserveIn, edgeAB.reserveOut,
    edgeBC.reserveIn, edgeBC.reserveOut,
    edgeCA.reserveIn, edgeCA.reserveOut
  );
  
  // Max amount should be at most MAX_POOL_USAGE_PERCENT of smallest reserve
  const maxSafeAmount = (minReserve * MAX_POOL_USAGE_PERCENT) / 100;
  
  // Filter test amounts that are within safe range
  const safeTestAmounts = BASE_TEST_AMOUNTS.filter(amt => amt <= maxSafeAmount);
  
  if (safeTestAmounts.length === 0) {
    // Pool too small, try very small amounts
    safeTestAmounts.push(maxSafeAmount / 10, maxSafeAmount / 5, maxSafeAmount / 2);
  }
  
  let bestResult = null;
  
  for (const amount of safeTestAmounts) {
    const result = simulateArbitragePath(tokenA, tokenB, tokenC, graph, amount);
    
    if (result.profitPercent > 0 && result.isExecutable) {
      if (!bestResult || result.profit > bestResult.profit) {
        bestResult = result;
        bestResult.maxSafeAmount = maxSafeAmount;
      }
    }
  }
  
  return bestResult;
}

function findArbitrage(pairs) {
  console.log(chalk.blue.bold('\n╔════════════════════════════════════════════╗'));
  console.log(chalk.blue.bold('║     BUILDING PRICE GRAPH & ANALYZING      ║'));
  console.log(chalk.blue.bold('╚════════════════════════════════════════════╝\n'));
  
  // Build adjacency list
  const graph = {};
  const tokenSet = new Set();
  const pairDetails = {};
  
  for (const pair of pairs) {
    if (!pair.reserve0 || !pair.reserve1 || pair.reserve0 === '0' || pair.reserve1 === '0') {
      continue;
    }
    
    const token0 = pair.token0;
    const token1 = pair.token1;
    const reserve0 = parseFloat(pair.reserve0);
    const reserve1 = parseFloat(pair.reserve1);
    
    tokenSet.add(token0);
    tokenSet.add(token1);
    
    if (!graph[token0]) graph[token0] = {};
    if (!graph[token1]) graph[token1] = {};
    
    pairDetails[pair.address] = {
      token0_short: pair.token0_short,
      token1_short: pair.token1_short,
      reserve0,
      reserve1
    };
    
    // token0 -> token1
    graph[token0][token1] = {
      price: calculatePrice(reserve0, reserve1),
      reserveIn: reserve0,
      reserveOut: reserve1,
      pair: pair.address,
      token0_short: pair.token0_short,
      token1_short: pair.token1_short
    };
    
    // token1 -> token0
    graph[token1][token0] = {
      price: calculatePrice(reserve1, reserve0),
      reserveIn: reserve1,
      reserveOut: reserve0,
      pair: pair.address,
      token0_short: pair.token1_short,
      token1_short: pair.token0_short
    };
  }
  
  const tokens = Array.from(tokenSet);
  console.log(chalk.cyan(`📊 Total unique tokens: ${chalk.bold(tokens.length)}`));
  console.log(chalk.cyan(`📈 Total trading pairs: ${chalk.bold(pairs.length)}`));
  console.log(chalk.gray(`   Tokens: ${tokens.map(t => t.split('::').pop()).slice(0, 10).join(', ')}...`));
  console.log();
  
  console.log(chalk.yellow.bold('🔍 Scanning for EXECUTABLE triangular arbitrage opportunities...\n'));
  console.log(chalk.gray(`   Max pool usage per trade: ${MAX_POOL_USAGE_PERCENT}%`));
  console.log(chalk.gray(`   Filtering for realistic, executable trades only\n`));
  
  const opportunities = [];
  let pathsChecked = 0;
  const startTime = Date.now();
  
  for (const tokenA of tokens) {
    if (!graph[tokenA]) continue;
    
    const neighbors = Object.keys(graph[tokenA]);
    for (const tokenB of neighbors) {
      if (!graph[tokenB]) continue;
      
      const nextNeighbors = Object.keys(graph[tokenB]);
      for (const tokenC of nextNeighbors) {
        if (tokenC === tokenA || tokenC === tokenB) continue;
        if (!graph[tokenC] || !graph[tokenC][tokenA]) continue;
        
        pathsChecked++;
        
        // Find optimal trade size (respecting liquidity constraints)
        const bestResult = findOptimalAmount(tokenA, tokenB, tokenC, graph);
        
        if (bestResult && bestResult.profitPercent > 0.1 && bestResult.isExecutable) {
          const tokenAShort = tokenA.split('::').pop();
          const tokenBShort = tokenB.split('::').pop();
          const tokenCShort = tokenC.split('::').pop();
          
          opportunities.push({
            path: [tokenAShort, tokenBShort, tokenCShort, tokenAShort],
            pathFull: [tokenA, tokenB, tokenC, tokenA],
            ...bestResult
          });
        }
      }
    }
  }
  
  const timeElapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  
  console.log(chalk.gray(`   ✓ Scanned ${chalk.bold(pathsChecked)} paths in ${chalk.bold(timeElapsed + 's')}\n`));
  
  // Sort by profit amount (absolute profit)
  opportunities.sort((a, b) => b.profit - a.profit);
  
  console.log(chalk.blue.bold('╔════════════════════════════════════════════╗'));
  console.log(chalk.blue.bold('║         EXECUTABLE OPPORTUNITIES           ║'));
  console.log(chalk.blue.bold('╚════════════════════════════════════════════╝\n'));
  
  if (opportunities.length === 0) {
    console.log(chalk.red.bold('❌ No EXECUTABLE profitable arbitrage opportunities found.\n'));
    console.log(chalk.gray('   Possible reasons:'));
    console.log(chalk.gray(`   • All opportunities require >${MAX_POOL_USAGE_PERCENT}% of pool liquidity (too risky)`));
    console.log(chalk.gray('   • Price impact too high (>20%)'));
    console.log(chalk.gray('   • Market is efficient (prices are balanced)'));
    console.log(chalk.gray('   • Fees (0.3% per swap) eat up potential profits\n'));
  } else {
    console.log(chalk.green.bold(`✅ Found ${opportunities.length} EXECUTABLE arbitrage opportunities!\n`));
    
    // Display top opportunities with full details
    const displayCount = Math.min(10, opportunities.length);
    
    for (let i = 0; i < displayCount; i++) {
      const opp = opportunities[i];
      
      const riskColor = opp.riskScore >= 60 ? chalk.red :
                       opp.riskScore >= 40 ? chalk.yellow :
                       chalk.green;
      
      console.log(chalk.white.bold(`${'═'.repeat(70)}`));
      console.log(chalk.white.bold(`  OPPORTUNITY #${i + 1} ${riskColor(`[Risk Score: ${opp.riskScore}/100]`)}`));
      console.log(chalk.white.bold(`${'═'.repeat(70)}\n`));
      
      console.log(chalk.yellow(`  📍 Route: ${chalk.bold(opp.path.join(' → '))}`));
      console.log();
      
      console.log(chalk.cyan(`  💰 Profit Analysis:`));
      console.log(chalk.white(`     Recommended Amount: ${chalk.bold(formatNumber(opp.startAmount))} ${opp.path[0]}`));
      console.log(chalk.gray(`     Max Safe Amount:    ${chalk.bold(formatNumber(opp.maxSafeAmount))} ${opp.path[0]} (${MAX_POOL_USAGE_PERCENT}% of smallest pool)`));
      console.log(chalk.white(`     Expected Return:    ${chalk.bold(formatNumber(opp.finalAmount))} ${opp.path[0]}`));
      console.log(chalk.green(`     Net Profit:         ${chalk.bold(formatNumber(opp.profit))} ${opp.path[0]} ${formatPercent(opp.profitPercent)}`));
      console.log(chalk.yellow(`     Max Pool Usage:     ${formatPoolUsage(opp.maxPoolUsage)}`));
      console.log(chalk.yellow(`     Total Price Impact: ${chalk.bold(opp.totalPriceImpact.toFixed(4) + '%')}`));
      console.log();
      
      console.log(chalk.magenta(`  🔄 Step-by-Step Execution:\n`));
      
      opp.steps.forEach((step, idx) => {
        const fromShort = step.from.split('::').pop();
        const toShort = step.to.split('::').pop();
        
        console.log(chalk.white.bold(`     Step ${idx + 1}: ${fromShort} → ${toShort} (${step.pairName})`));
        console.log(chalk.gray(`     Pair: ${step.pair.slice(0, 20)}...`));
        console.log(chalk.white(`     • Swap In:  ${chalk.bold(formatNumber(step.amountIn))} ${fromShort} (${formatPoolUsage(step.poolUsageIn)} of pool)`));
        console.log(chalk.white(`     • Swap Out: ${chalk.bold(formatNumber(step.amountOut))} ${toShort} (${formatPoolUsage(step.poolUsageOut)} of pool)`));
        console.log(chalk.yellow(`     • Price Impact: ${chalk.bold(step.priceImpact.toFixed(4) + '%')}`));
        console.log(chalk.gray(`     • Pool Reserves: ${formatNumber(step.reserveInBefore)} ${fromShort} / ${formatNumber(step.reserveOutBefore)} ${toShort}`));
        console.log(chalk.gray(`     • After Trade:   ${formatNumber(step.reserveInAfter)} ${fromShort} / ${formatNumber(step.reserveOutAfter)} ${toShort}`));
        console.log();
      });
      
      // Detailed risk assessment
      console.log(chalk.red(`  ⚠️  Risk Assessment & Execution Notes:\n`));
      
      if (opp.maxPoolUsage > 5) {
        console.log(chalk.red(`     • HIGH LIQUIDITY USAGE: Using ${opp.maxPoolUsage.toFixed(2)}% of pool`));
        console.log(chalk.red(`     • Risk: Front-running and MEV bot competition likely`));
      } else if (opp.maxPoolUsage > 2) {
        console.log(chalk.yellow(`     • MEDIUM LIQUIDITY USAGE: Using ${opp.maxPoolUsage.toFixed(2)}% of pool`));
        console.log(chalk.yellow(`     • Risk: Some slippage expected`));
      } else {
        console.log(chalk.green(`     • LOW LIQUIDITY USAGE: Using ${opp.maxPoolUsage.toFixed(2)}% of pool`));
        console.log(chalk.green(`     • Risk: Minimal slippage, good execution probability`));
      }
      
      if (opp.totalPriceImpact > 5) {
        console.log(chalk.red(`     • HIGH PRICE IMPACT: ${opp.totalPriceImpact.toFixed(2)}% total`));
        console.log(chalk.red(`     • Recommendation: Split trade into smaller chunks`));
      } else if (opp.totalPriceImpact > 2) {
        console.log(chalk.yellow(`     • MEDIUM PRICE IMPACT: ${opp.totalPriceImpact.toFixed(2)}% total`));
        console.log(chalk.yellow(`     • Recommendation: Monitor for better timing`));
      } else {
        console.log(chalk.green(`     • LOW PRICE IMPACT: ${opp.totalPriceImpact.toFixed(2)}% total`));
        console.log(chalk.green(`     • Recommendation: Safe to execute`));
      }
      
      // Liquidity warnings
      const minReserve = Math.min(...opp.steps.map(s => Math.min(s.reserveInBefore, s.reserveOutBefore)));
      if (minReserve < 100000) {
        console.log(chalk.red(`     • WARNING: Very low liquidity (min reserve: ${formatNumber(minReserve)})`));
        console.log(chalk.red(`     • High risk of failed transaction or extreme slippage`));
      } else if (minReserve < 1000000) {
        console.log(chalk.yellow(`     • CAUTION: Low liquidity pool detected (min reserve: ${formatNumber(minReserve)})`));
      } else {
        console.log(chalk.green(`     • Good liquidity across all pools (min reserve: ${formatNumber(minReserve)})`));
      }
      
      // Gas estimation
      console.log(chalk.cyan(`\n     💎 Execution Details:`));
      console.log(chalk.white(`     • Transaction Type: 3 swaps in single PTB (Programmable Transaction Block)`));
      console.log(chalk.white(`     • Estimated Gas: ~0.01-0.02 SUI (~$0.02-$0.04)`));
      console.log(chalk.white(`     • Slippage Tolerance: Recommend 1-2% based on price impact`));
      
      console.log();
    }
    
    console.log(chalk.white.bold(`${'═'.repeat(70)}\n`));
    
    // Summary statistics
    console.log(chalk.blue.bold('📊 SUMMARY STATISTICS:\n'));
    
    const avgProfit = opportunities.reduce((sum, o) => sum + o.profitPercent, 0) / opportunities.length;
    const maxProfit = Math.max(...opportunities.map(o => o.profitPercent));
    const minProfit = Math.min(...opportunities.map(o => o.profitPercent));
    const avgImpact = opportunities.reduce((sum, o) => sum + o.totalPriceImpact, 0) / opportunities.length;
    const avgPoolUsage = opportunities.reduce((sum, o) => sum + o.maxPoolUsage, 0) / opportunities.length;
    const avgRisk = opportunities.reduce((sum, o) => sum + o.riskScore, 0) / opportunities.length;
    
    const lowRisk = opportunities.filter(o => o.riskScore < 40).length;
    const medRisk = opportunities.filter(o => o.riskScore >= 40 && o.riskScore < 60).length;
    const highRisk = opportunities.filter(o => o.riskScore >= 60).length;
    
    console.log(chalk.white(`   Average Profit:       ${formatPercent(avgProfit)}`));
    console.log(chalk.white(`   Max Profit:           ${formatPercent(maxProfit)}`));
    console.log(chalk.white(`   Min Profit:           ${formatPercent(minProfit)}`));
    console.log(chalk.white(`   Avg Price Impact:     ${chalk.bold(avgImpact.toFixed(4) + '%')}`));
    console.log(chalk.white(`   Avg Pool Usage:       ${chalk.bold(avgPoolUsage.toFixed(2) + '%')}`));
    console.log(chalk.white(`   Avg Risk Score:       ${chalk.bold(avgRisk.toFixed(0) + '/100')}`));
    console.log();
    console.log(chalk.white(`   Risk Distribution:`));
    console.log(chalk.green(`     • Low Risk (0-39):    ${lowRisk} opportunities`));
    console.log(chalk.yellow(`     • Medium Risk (40-59): ${medRisk} opportunities`));
    console.log(chalk.red(`     • High Risk (60-100):  ${highRisk} opportunities`));
    console.log();
    
    // Best opportunities by category
    console.log(chalk.cyan.bold('🏆 Best Opportunities by Category:\n'));
    
    const bestProfit = opportunities[0];
    console.log(chalk.white(`   💰 Highest Absolute Profit:`));
    console.log(chalk.white(`      ${bestProfit.path.join(' → ')}: ${formatNumber(bestProfit.profit)} ${bestProfit.path[0]} profit`));
    console.log(chalk.gray(`      Start with: ${formatNumber(bestProfit.startAmount)} ${bestProfit.path[0]}\n`));
    
    const lowestRisk = opportunities.sort((a, b) => a.riskScore - b.riskScore)[0];
    opportunities.sort((a, b) => b.profit - a.profit); // Re-sort
    console.log(chalk.white(`   🛡️  Lowest Risk:`));
    console.log(chalk.white(`      ${lowestRisk.path.join(' → ')}: Risk score ${lowestRisk.riskScore}/100`));
    console.log(chalk.gray(`      Start with: ${formatNumber(lowestRisk.startAmount)} ${lowestRisk.path[0]}\n`));
    
    // Token frequency
    const tokenFreq = {};
    opportunities.forEach(opp => {
      opp.path.forEach(token => {
        tokenFreq[token] = (tokenFreq[token] || 0) + 1;
      });
    });
    
    const topTokens = Object.entries(tokenFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    console.log(chalk.cyan.bold('🎯 Most Active Tokens in Arbitrage:\n'));
    topTokens.forEach(([token, count], idx) => {
      console.log(chalk.white(`   ${idx + 1}. ${chalk.bold(token)}: ${chalk.bold(count)} opportunities`));
    });
    console.log();
  }
  
  return opportunities;
}

async function main() {
  console.log(chalk.magenta.bold('\n╔════════════════════════════════════════════════════════════╗'));
  console.log(chalk.magenta.bold('║                                                            ║'));
  console.log(chalk.magenta.bold('║    🚀 SUITRUMP DEX ARBITRAGE SCANNER v3.0 (VALIDATED) 🚀   ║'));
  console.log(chalk.magenta.bold('║                                                            ║'));
  console.log(chalk.magenta.bold('╚════════════════════════════════════════════════════════════╝\n'));
  
  try {
    console.log(chalk.blue('📂 Loading pairs from pairs-data.json...\n'));
    
    if (!fs.existsSync('pairs-data.json')) {
      console.log(chalk.red.bold('❌ Error: pairs-data.json not found!'));
      console.log(chalk.yellow('   Please run: node fetch-pairs.js first\n'));
      return;
    }
    
    const data = JSON.parse(fs.readFileSync('pairs-data.json', 'utf8'));
    console.log(chalk.green(`✓ Loaded ${chalk.bold(data.pairs.length)} pairs from file`));
    console.log(chalk.gray(`  Last updated: ${data.timestamp}\n`));
    
    console.log(chalk.blue.bold('🔄 Fetching Real-Time Reserves...\n'));
    const updatedPairs = [];
    const failedPairs = [];
    
    for (let i = 0; i < data.pairs.length; i++) {
      const pair = data.pairs[i];
      const pairName = `${pair.token0_short}/${pair.token1_short}`;
      
      process.stdout.write(chalk.cyan(`   [${i + 1}/${data.pairs.length}] ${pairName.padEnd(30)}`));
      
      const reserves = await fetchRealTimeReserves(pair.address);
      
      if (reserves) {
        updatedPairs.push({
          ...pair,
          reserve0: reserves.reserve0,
          reserve1: reserves.reserve1
        });
        console.log(chalk.green('✓'));
      } else {
        failedPairs.push(pairName);
        console.log(chalk.red('✗'));
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(chalk.green.bold(`\n✓ Successfully updated ${updatedPairs.length}/${data.pairs.length} pairs`));
    if (failedPairs.length > 0) {
      console.log(chalk.red(`✗ Failed to fetch: ${failedPairs.join(', ')}`));
    }
    console.log();
    
    const opportunities = findArbitrage(updatedPairs);
    
    if (opportunities.length > 0) {
      const outputData = {
        timestamp: new Date().toISOString(),
        total_opportunities: opportunities.length,
        max_pool_usage_percent: MAX_POOL_USAGE_PERCENT,
        opportunities: opportunities.map(opp => ({
          ...opp,
          steps: opp.steps.map(step => ({
            ...step,
            from: step.from.split('::').pop(),
            to: step.to.split('::').pop()
          }))
        }))
      };
      
      fs.writeFileSync('arbitrage-opportunities.json', JSON.stringify(outputData, null, 2));
      console.log(chalk.green.bold('💾 Saved detailed results to arbitrage-opportunities.json\n'));
    }
    
    console.log(chalk.magenta.bold('═'.repeat(70)));
    console.log(chalk.magenta.bold('                    Scan Complete!'));
    console.log(chalk.magenta.bold('═'.repeat(70) + '\n'));
    
  } catch (error) {
    console.error(chalk.red.bold('\n❌ FATAL ERROR:\n'));
    console.error(chalk.red(error.message));
    if (error.stack) {
      console.error(chalk.gray('\nStack trace:'));
      console.error(chalk.gray(error.stack));
    }
    console.log();
  }
}

main();