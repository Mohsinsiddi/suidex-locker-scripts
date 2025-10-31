// fetch-pairs.js
const { SuiClient } = require('@mysten/sui/client');
const fs = require('fs');

const MAINNET_RPC = 'https://fullnode.mainnet.sui.io:443';
const FACTORY_ID = '0x81c286135713b4bf2e78c548f5643766b5913dcd27a8e76469f146ab811e922d';

const client = new SuiClient({ url: MAINNET_RPC });

async function fetchAllPairs() {
  console.log('Fetching factory object...\n');
  
  try {
    const factoryObj = await client.getObject({
      id: FACTORY_ID,
      options: { showContent: true }
    });
    
    if (!factoryObj.data?.content?.fields) {
      console.error('Could not fetch factory data');
      return;
    }
    
    const allPairsField = factoryObj.data.content.fields.all_pairs;
    console.log(`Found ${allPairsField.length} pairs in factory\n`);
    
    const pairs = [];
    
    for (let i = 0; i < allPairsField.length; i++) {
      const pairAddr = allPairsField[i];
      console.log(`[${i + 1}/${allPairsField.length}] Fetching pair: ${pairAddr}`);
      
      try {
        const pairObj = await client.getObject({
          id: pairAddr,
          options: { showContent: true, showType: true }
        });
        
        if (!pairObj.data?.content?.fields || !pairObj.data?.type) {
          console.log(`  ⚠️  Skipping - no data`);
          continue;
        }
        
        const fields = pairObj.data.content.fields;
        const typeMatch = pairObj.data.type.match(/<(.+)>/);
        
        if (!typeMatch) {
          console.log(`  ⚠️  Skipping - could not parse type`);
          continue;
        }
        
        const typeParams = typeMatch[1].split(',').map(t => t.trim());
        
        if (typeParams.length !== 2) {
          console.log(`  ⚠️  Skipping - invalid type params`);
          continue;
        }
        
        const token0 = typeParams[0];
        const token1 = typeParams[1];
        const reserve0 = fields.reserve0;
        const reserve1 = fields.reserve1;
        
        // Get short names for display
        const token0Short = token0.split('::').pop();
        const token1Short = token1.split('::').pop();
        
        console.log(`  ✓ ${token0Short}/${token1Short}`);
        console.log(`    Reserve0: ${reserve0}`);
        console.log(`    Reserve1: ${reserve1}`);
        
        pairs.push({
          address: pairAddr,
          token0,
          token1,
          token0_short: token0Short,
          token1_short: token1Short,
          reserve0,
          reserve1,
          name: fields.name,
          symbol: fields.symbol,
          total_supply: fields.total_supply
        });
        
      } catch (err) {
        console.log(`  ⚠️  Error fetching pair: ${err.message}`);
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`\n✓ Successfully fetched ${pairs.length} pairs`);
    
    // Save to JSON
    const output = {
      timestamp: new Date().toISOString(),
      factory: FACTORY_ID,
      total_pairs: pairs.length,
      pairs
    };
    
    fs.writeFileSync('pairs-data.json', JSON.stringify(output, null, 2));
    console.log('\n✓ Saved to pairs-data.json');
    
    // Print summary
    console.log('\n=== SUMMARY ===');
    console.log(`Total pairs: ${pairs.length}`);
    const uniqueTokens = new Set();
    pairs.forEach(p => {
      uniqueTokens.add(p.token0);
      uniqueTokens.add(p.token1);
    });
    console.log(`Unique tokens: ${uniqueTokens.size}`);
    
  } catch (error) {
    console.error('Error:', error.message);
    if (error.stack) console.error(error.stack);
  }
}

fetchAllPairs();