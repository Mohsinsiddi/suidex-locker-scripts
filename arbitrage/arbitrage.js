// find-arbitrage.js
const { SuiClient } = require('@mysten/sui/client');

const MAINNET_RPC = 'https://fullnode.mainnet.sui.io:443';

const PACKAGE_ID = '0xbfac5e1c6bf6ef29b12f7723857695fd2f4da9a11a7d88162c15e9124c243a4a';
const ROUTER_ID = '0x9cdbbd092634efdc0e7033dc1c49d9ea5fc9bc5969ba708f55e05b6fcac12177';
const FACTORY_ID = '0x81c286135713b4bf2e78c548f5643766b5913dcd27a8e76469f146ab811e922d';

const client = new SuiClient({ url: MAINNET_RPC });

async function getAllPairs() {
  console.log('Fetching factory object...');
  const factoryObj = await client.getObject({
    id: FACTORY_ID,
    options: { showContent: true }
  });
  
  console.log('Factory object:', JSON.stringify(factoryObj, null, 2));
  
  // Get dynamic fields (pairs mapping)
  console.log('\nFetching dynamic fields (pairs)...');
  const dynamicFields = await client.getDynamicFields({
    parentId: FACTORY_ID
  });
  
  console.log(`Found ${dynamicFields.data.length} pairs\n`);
  
  const pairs = [];
  
  for (const field of dynamicFields.data) {
    console.log('Field:', JSON.stringify(field, null, 2));
    
    // Get the pair object
    const pairFieldObj = await client.getDynamicFieldObject({
      parentId: FACTORY_ID,
      name: field.name
    });
    
    console.log('Pair field object:', JSON.stringify(pairFieldObj, null, 2));
    
    if (pairFieldObj.data?.content?.fields) {
      const pairId = pairFieldObj.data.content.fields.value;
      console.log(`Getting pair details for: ${pairId}`);
      
      const pairObj = await client.getObject({
        id: pairId,
        options: { showContent: true, showType: true }
      });
      
      console.log('Pair object:', JSON.stringify(pairObj, null, 2));
      
      if (pairObj.data?.content?.fields) {
        const fields = pairObj.data.content.fields;
        const typeParams = pairObj.data.type.match(/<(.+)>/)?.[1].split(',').map(t => t.trim());
        
        pairs.push({
          id: pairId,
          token0: typeParams?.[0] || 'unknown',
          token1: typeParams?.[1] || 'unknown',
          reserve0: BigInt(fields.reserve0 || 0),
          reserve1: BigInt(fields.reserve1 || 0),
          token0_decimal: parseInt(fields.token0_decimal || 6),
          token1_decimal: parseInt(fields.token1_decimal || 6)
        });
        
        console.log(`\nPair ${pairId}:`);
        console.log(`  Token0: ${typeParams?.[0]}`);
        console.log(`  Token1: ${typeParams?.[1]}`);
        console.log(`  Reserve0: ${fields.reserve0}`);
        console.log(`  Reserve1: ${fields.reserve1}`);
        console.log(`  Price: ${calculatePrice(BigInt(fields.reserve0), BigInt(fields.reserve1), fields.token0_decimal, fields.token1_decimal)}`);
        console.log('---');
      }
    }
  }
  
  return pairs;
}

function calculatePrice(reserve0, reserve1, decimal0, decimal1) {
  if (reserve0 === 0n) return 0;
  
  // Price of token0 in terms of token1
  const price = Number(reserve1 * BigInt(10 ** decimal0)) / Number(reserve0 * BigInt(10 ** decimal1));
  return price;
}

function findArbitrage(pairs) {
  console.log('\n=== ARBITRAGE OPPORTUNITIES ===\n');
  
  // Build a price graph
  const priceGraph = {};
  const tokenSet = new Set();
  
  for (const pair of pairs) {
    tokenSet.add(pair.token0);
    tokenSet.add(pair.token1);
    
    // Add both directions
    if (!priceGraph[pair.token0]) priceGraph[pair.token0] = {};
    if (!priceGraph[pair.token1]) priceGraph[pair.token1] = {};
    
    const price0to1 = calculatePrice(pair.reserve0, pair.reserve1, pair.token0_decimal, pair.token1_decimal);
    const price1to0 = calculatePrice(pair.reserve1, pair.reserve0, pair.token1_decimal, pair.token0_decimal);
    
    priceGraph[pair.token0][pair.token1] = { price: price0to1, pair: pair.id };
    priceGraph[pair.token1][pair.token0] = { price: price1to0, pair: pair.id };
  }
  
  const tokens = Array.from(tokenSet);
  console.log(`Total unique tokens: ${tokens.length}`);
  console.log('Tokens:', tokens.map(t => t.split('::').pop()).join(', '));
  console.log();
  
  // Look for triangular arbitrage: A -> B -> C -> A
  const opportunities = [];
  
  for (const tokenA of tokens) {
    for (const tokenB of tokens) {
      if (tokenA === tokenB || !priceGraph[tokenA]?.[tokenB]) continue;
      
      for (const tokenC of tokens) {
        if (tokenC === tokenA || tokenC === tokenB) continue;
        if (!priceGraph[tokenB]?.[tokenC] || !priceGraph[tokenC]?.[tokenA]) continue;
        
        // Calculate the profit ratio for A -> B -> C -> A
        const priceAB = priceGraph[tokenA][tokenB].price;
        const priceBC = priceGraph[tokenB][tokenC].price;
        const priceCA = priceGraph[tokenC][tokenA].price;
        
        const finalAmount = priceAB * priceBC * priceCA;
        const profitRatio = (finalAmount - 1) * 100; // Percentage profit
        
        // Account for fees (0.3% per swap = 0.997 multiplier per swap)
        const afterFees = finalAmount * (0.997 ** 3);
        const profitAfterFees = (afterFees - 1) * 100;
        
        if (profitAfterFees > 0.1) { // At least 0.1% profit after fees
          opportunities.push({
            path: [tokenA, tokenB, tokenC, tokenA],
            profitBeforeFees: profitRatio,
            profitAfterFees: profitAfterFees,
            pairs: [
              priceGraph[tokenA][tokenB].pair,
              priceGraph[tokenB][tokenC].pair,
              priceGraph[tokenC][tokenA].pair
            ]
          });
        }
      }
    }
  }
  
  // Sort by profit
  opportunities.sort((a, b) => b.profitAfterFees - a.profitAfterFees);
  
  if (opportunities.length === 0) {
    console.log('No profitable arbitrage opportunities found.');
  } else {
    console.log(`Found ${opportunities.length} arbitrage opportunities:\n`);
    
    for (let i = 0; i < Math.min(10, opportunities.length); i++) {
      const opp = opportunities[i];
      console.log(`${i + 1}. Path:`);
      opp.path.forEach((token, idx) => {
        const shortName = token.split('::').pop();
        console.log(`   ${idx === 0 ? 'Start:' : '  ->  '} ${shortName}`);
      });
      console.log(`   Profit (before fees): ${opp.profitBeforeFees.toFixed(4)}%`);
      console.log(`   Profit (after fees):  ${opp.profitAfterFees.toFixed(4)}%`);
      console.log(`   Pairs: ${opp.pairs.map(p => p.slice(0, 10) + '...').join(' -> ')}`);
      console.log();
    }
  }
}

async function main() {
  try {
    const pairs = await getAllPairs();
    console.log(`\nTotal pairs found: ${pairs.length}\n`);
    
    if (pairs.length > 0) {
      findArbitrage(pairs);
    }
  } catch (error) {
    console.error('Error:', error);
    if (error.stack) console.error(error.stack);
  }
}

main();