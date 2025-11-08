// fetch-victory-token-info.js
const { SuiClient } = require('@mysten/sui/client');
const chalk = require('chalk');

const MAINNET_RPC = 'https://fullnode.mainnet.sui.io:443';

// TODO: Replace these with your actual values
const VICTORY_PACKAGE_ID = '0xbfac5e1c6bf6ef29b12f7723857695fd2f4da9a11a7d88162c15e9124c243a4a';
const TREASURY_WRAPPER_ID = '0x12035ff707ae772977c5102f8214c3c8b568929861717fcc73f5b67acafb1ce1';

const client = new SuiClient({ url: MAINNET_RPC });

async function fetchVictoryTokenInfo() {
  console.log(chalk.blue.bold('\n╔════════════════════════════════════════════╗'));
  console.log(chalk.blue.bold('║      VICTORY TOKEN INFO - SUI MAINNET      ║'));
  console.log(chalk.blue.bold('╚════════════════════════════════════════════╝\n'));
  
  try {
    const victoryType = `${VICTORY_PACKAGE_ID}::victory_token::VICTORY_TOKEN`;
    
    // Fetch coin metadata
    console.log(chalk.cyan('📊 Fetching coin metadata...\n'));
    const metadata = await client.getCoinMetadata({ coinType: victoryType });
    
    if (!metadata) {
      console.log(chalk.red('❌ Could not fetch metadata'));
      return;
    }
    
    console.log(chalk.green.bold('✓ Metadata:'));
    console.log(chalk.white(`   Name:        ${chalk.bold(metadata.name)}`));
    console.log(chalk.white(`   Symbol:      ${chalk.bold(metadata.symbol)}`));
    console.log(chalk.white(`   Decimals:    ${chalk.bold(metadata.decimals)}`));
    console.log(chalk.white(`   Description: ${metadata.description}`));
    if (metadata.iconUrl) {
      console.log(chalk.white(`   Icon URL:    ${metadata.iconUrl}`));
    }
    console.log();
    
    // Fetch TreasuryCapWrapper to get supply info
    console.log(chalk.cyan('🔍 Fetching supply information...\n'));
    const wrapperObj = await client.getObject({
      id: TREASURY_WRAPPER_ID,
      options: { showContent: true }
    });
    
    if (!wrapperObj.data?.content?.fields) {
      console.log(chalk.red('❌ Could not fetch treasury wrapper'));
      return;
    }
    
    const treasuryCap = wrapperObj.data.content.fields.cap;
    const totalSupplyRaw = treasuryCap.fields.total_supply.fields.value;
    
    // Convert to human-readable format
    const decimals = metadata.decimals;
    const totalSupply = parseFloat(totalSupplyRaw) / Math.pow(10, decimals);
    
    // Max supply is 500M
    const MAX_SUPPLY = 500_000_000;
    const remainingSupply = MAX_SUPPLY - totalSupply;
    const percentMinted = (totalSupply / MAX_SUPPLY * 100).toFixed(2);
    
    console.log(chalk.green.bold('✓ Supply Information:'));
    console.log(chalk.white(`   Total Supply:     ${chalk.bold(totalSupply.toLocaleString())} VICTORY`));
    console.log(chalk.white(`   Max Supply:       ${chalk.bold(MAX_SUPPLY.toLocaleString())} VICTORY`));
    console.log(chalk.white(`   Remaining:        ${chalk.bold(remainingSupply.toLocaleString())} VICTORY`));
    console.log(chalk.white(`   Minted:           ${chalk.bold(percentMinted + '%')}`));
    console.log();
    
    // Summary box
    console.log(chalk.blue.bold('╔════════════════════════════════════════════╗'));
    console.log(chalk.blue.bold('║              SUMMARY                       ║'));
    console.log(chalk.blue.bold('╚════════════════════════════════════════════╝\n'));
    
    console.log(chalk.white(`   Token Type:       ${victoryType}`));
    console.log(chalk.white(`   Current Supply:   ${chalk.green.bold(totalSupply.toLocaleString() + ' VICTORY')}`));
    console.log(chalk.white(`   Circulating:      ${chalk.cyan.bold(percentMinted + '%')} of max supply`));
    console.log();
    
  } catch (error) {
    console.error(chalk.red.bold('\n❌ Error:'), error.message);
    if (error.stack) console.error(chalk.gray(error.stack));
  }
}

fetchVictoryTokenInfo();