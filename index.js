const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');

// Configuration
const NETWORK = 'testnet';
// const PACKAGE_ID = '0xfa5c3dd1022b14ab1ac91ad140f5e765ab5b993ef944a9caad33073b6c30df19'; old one
const PACKAGE_ID = '0x381ff77a7fc9af27a9ca765bb0fb2a7daa4516621a44182dc01de2eb8a8053c7'; // Example mainnet ID
const MODULE_NAME = 'victory_token_locker';
const TARGET_USER = '0x11d00b1f0594da0aedc3dab291e619cea33e5cfcd3554738bfc1dd0375b65b56';

const RPC_URL = getFullnodeUrl(NETWORK);
const client = new SuiClient({ url: RPC_URL });

console.log(`📡 RPC Endpoint: ${RPC_URL}\n`);

/**
 * Test network connectivity
 */
async function testConnection() {
    console.log('🔌 Testing connection to Sui RPC...\n');
    
    try {
        const chainId = await client.getChainIdentifier();
        console.log(`✅ Connected! Chain ID: ${chainId}`);
        
        const latestCheckpoint = await client.getLatestCheckpointSequenceNumber();
        console.log(`✅ Latest checkpoint: ${latestCheckpoint}\n`);
        
        return true;
    } catch (error) {
        console.error('❌ Connection failed:', error.message);
        return false;
    }
}

/**
 * Retry wrapper with exponential backoff
 */
async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 1000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            if (attempt < maxRetries) {
                const delay = initialDelay * Math.pow(2, attempt - 1);
                console.log(`⚠️  Attempt ${attempt} failed: ${error.message}`);
                console.log(`⏳ Retrying in ${delay / 1000}s...\n`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw lastError;
}

/**
 * ✅ METHOD 1: Fetch user-created locks (user is sender)
 */
async function fetchUserCreatedLocks(userAddress) {
    console.log(`📦 Fetching USER-CREATED locks (sender = user)...\n`);
    console.log('─'.repeat(70));
    
    let allLocks = [];
    let cursor = null;
    let hasNextPage = true;
    let pageCount = 0;
    let totalScanned = 0;
    const startTime = Date.now();

    try {
        while (hasNextPage) {
            const result = await retryWithBackoff(async () => {
                return await client.queryEvents({
                    query: { Sender: userAddress },
                    cursor,
                    limit: 50,
                    order: 'descending'
                });
            });

            pageCount++;
            totalScanned += result.data.length;

            // Filter for TokensLocked events
            const lockEvents = result.data.filter(event => 
                event.type === `${PACKAGE_ID}::${MODULE_NAME}::TokensLocked`
            );

            allLocks.push(...lockEvents);

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`✓ Page ${pageCount}: ${result.data.length} events | ${lockEvents.length} locks | Total: ${allLocks.length} | ${elapsed}s`);

            hasNextPage = result.hasNextPage;
            cursor = result.nextCursor || null;

            if (hasNextPage) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ User-created locks: ${allLocks.length} (scanned ${totalScanned} events in ${totalTime}s)\n`);

        return allLocks;

    } catch (error) {
        console.error(`❌ Error fetching user-created locks:`, error.message);
        throw error;
    }
}

/**
 * ✅ METHOD 2: Fetch admin-created locks (user is recipient)
 */
async function fetchAdminCreatedLocks(userAddress) {
    console.log(`👨‍💼 Fetching ADMIN-CREATED locks (user = recipient)...\n`);
    console.log('─'.repeat(70));
    
    const normalizedUser = userAddress.toLowerCase();
    let allLocks = [];
    let cursor = null;
    let hasNextPage = true;
    let pageCount = 0;
    let totalScanned = 0;
    let consecutiveEmptyPages = 0;
    const MAX_EMPTY_PAGES = 10;
    const startTime = Date.now();

    try {
        while (hasNextPage && consecutiveEmptyPages < MAX_EMPTY_PAGES) {
            const result = await retryWithBackoff(async () => {
                return await client.queryEvents({
                    query: { 
                        MoveEventType: `${PACKAGE_ID}::${MODULE_NAME}::AdminPresaleLockCreated`
                    },
                    cursor,
                    limit: 50,
                    order: 'descending'
                });
            });

            pageCount++;
            totalScanned += result.data.length;

            // Filter for this specific user (admin can create locks for ANY user)
            const userLocks = result.data.filter(event => 
                event.parsedJson.user.toLowerCase() === normalizedUser
            );

            if (userLocks.length > 0) {
                allLocks.push(...userLocks);
                consecutiveEmptyPages = 0;
                console.log(`✓ Page ${pageCount}: ${userLocks.length} matches | Total: ${allLocks.length} 🎯`);
            } else {
                consecutiveEmptyPages++;
                console.log(`✓ Page ${pageCount}: 0 matches | Empty: ${consecutiveEmptyPages}/${MAX_EMPTY_PAGES}`);
            }

            hasNextPage = result.hasNextPage;
            cursor = result.nextCursor || null;

            // Early exit if found locks but then many empty pages
            if (allLocks.length > 0 && consecutiveEmptyPages >= 5) {
                console.log(`⚠️  Early exit: Found locks but ${consecutiveEmptyPages} consecutive empty pages\n`);
                break;
            }

            if (hasNextPage) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ Admin-created locks: ${allLocks.length} (scanned ${totalScanned} events in ${totalTime}s)\n`);

        return allLocks;

    } catch (error) {
        console.error(`❌ Error fetching admin-created locks:`, error.message);
        throw error;
    }
}

/**
 * 🎯 Fetch ALL locks for user (both types)
 */
async function fetchAllUserLocks(userAddress) {
    console.log(`\n🔍 Fetching ALL locks for: ${userAddress}\n`);
    console.log('═'.repeat(70));

    const [userCreatedLocks, adminCreatedLocks] = await Promise.all([
        fetchUserCreatedLocks(userAddress),
        fetchAdminCreatedLocks(userAddress)
    ]);

    return {
        userCreated: userCreatedLocks,
        adminCreated: adminCreatedLocks,
        total: userCreatedLocks.length + adminCreatedLocks.length
    };
}

/**
 * Format helpers
 */
function formatAmount(amount, decimals = 6) {
    return (Number(amount) / Math.pow(10, decimals)).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatLockPeriod(days) {
    const periods = {
        '7': '1 Week',
        '90': '3 Months',
        '365': '1 Year',
        '1095': '3 Years'
    };
    return periods[days] || `${days} days`;
}

function formatDate(timestamp) {
    return new Date(Number(timestamp) * 1000).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Display comprehensive lock summary
 */
function displayAllLocks(result, userAddress) {
    console.log('═'.repeat(70));
    console.log('📊 COMPLETE USER LOCK SUMMARY');
    console.log('═'.repeat(70));

    console.log(`\n👤 User: ${userAddress}`);
    console.log(`📦 User-Created Locks: ${result.userCreated.length}`);
    console.log(`👨‍💼 Admin-Created Locks: ${result.adminCreated.length}`);
    console.log(`🔒 Total Locks: ${result.total}`);

    if (result.total === 0) {
        console.log('\n⚠️  No locks found for this user\n');
        return;
    }

    // Calculate totals
    const userTotal = result.userCreated.reduce((sum, e) => sum + Number(e.parsedJson.amount), 0);
    const adminTotal = result.adminCreated.reduce((sum, e) => sum + Number(e.parsedJson.amount), 0);
    const grandTotal = userTotal + adminTotal;

    console.log(`\n💰 User-Created Amount: ${formatAmount(userTotal)} VICTORY`);
    console.log(`💰 Admin-Created Amount: ${formatAmount(adminTotal)} VICTORY`);
    console.log(`💎 Total Amount: ${formatAmount(grandTotal)} VICTORY`);

    // Lock period distribution (combined)
    const allLocks = [...result.userCreated, ...result.adminCreated];
    const periodCounts = {};
    const periodAmounts = {};
    
    allLocks.forEach(event => {
        const period = formatLockPeriod(event.parsedJson.lock_period);
        const amount = Number(event.parsedJson.amount);
        periodCounts[period] = (periodCounts[period] || 0) + 1;
        periodAmounts[period] = (periodAmounts[period] || 0) + amount;
    });

    console.log('\n📅 Lock Distribution (All):');
    Object.entries(periodCounts).forEach(([period, count]) => {
        const amount = periodAmounts[period];
        console.log(`   ${period.padEnd(12)}: ${count} locks | ${formatAmount(amount)} VICTORY`);
    });

    // Display user-created locks
    if (result.userCreated.length > 0) {
        console.log('\n' + '═'.repeat(70));
        console.log('📦 USER-CREATED LOCKS');
        console.log('═'.repeat(70));

        result.userCreated.slice(0, 10).forEach((event, i) => {
            const lock = event.parsedJson;
            console.log(`\n${i + 1}. Lock ID: ${lock.lock_id}`);
            console.log(`   💰 Amount: ${formatAmount(lock.amount)} VICTORY`);
            console.log(`   ⏱️  Period: ${formatLockPeriod(lock.lock_period)}`);
            console.log(`   📅 Unlock: ${formatDate(lock.lock_end)}`);
            console.log(`   🔗 TX: ${event.id.txDigest}`);
        });

        if (result.userCreated.length > 10) {
            console.log(`\n... and ${result.userCreated.length - 10} more user-created locks`);
        }
    }

    // Display admin-created locks
    if (result.adminCreated.length > 0) {
        console.log('\n' + '═'.repeat(70));
        console.log('👨‍💼 ADMIN-CREATED LOCKS');
        console.log('═'.repeat(70));

        result.adminCreated.slice(0, 10).forEach((event, i) => {
            const lock = event.parsedJson;
            console.log(`\n${i + 1}. Lock ID: ${lock.lock_id}`);
            console.log(`   💰 Amount: ${formatAmount(lock.amount)} VICTORY`);
            console.log(`   ⏱️  Period: ${formatLockPeriod(lock.lock_period)}`);
            console.log(`   📅 Unlock: ${formatDate(lock.lock_end)}`);
            console.log(`   👨‍💼 Admin: ${lock.admin}`);
            console.log(`   🔗 TX: ${event.id.txDigest}`);
        });

        if (result.adminCreated.length > 10) {
            console.log(`\n... and ${result.adminCreated.length - 10} more admin-created locks`);
        }
    }
}

/**
 * Export to JSON
 */
async function exportToJSON(result, userAddress) {
    const fs = require('fs').promises;
    
    const data = {
        metadata: {
            network: NETWORK,
            packageId: PACKAGE_ID,
            userAddress,
            fetchedAt: new Date().toISOString()
        },
        summary: {
            userCreatedLocks: result.userCreated.length,
            adminCreatedLocks: result.adminCreated.length,
            totalLocks: result.total
        },
        userCreatedLocks: result.userCreated.map(event => ({
            lockId: event.parsedJson.lock_id,
            amount: event.parsedJson.amount,
            lockPeriod: event.parsedJson.lock_period,
            lockEnd: event.parsedJson.lock_end,
            user: event.parsedJson.user,
            txDigest: event.id.txDigest,
            timestamp: event.timestampMs,
            createdBy: 'user'
        })),
        adminCreatedLocks: result.adminCreated.map(event => ({
            lockId: event.parsedJson.lock_id,
            amount: event.parsedJson.amount,
            lockPeriod: event.parsedJson.lock_period,
            lockEnd: event.parsedJson.lock_end,
            user: event.parsedJson.user,
            admin: event.parsedJson.admin,
            txDigest: event.id.txDigest,
            timestamp: event.parsedJson.timestamp,
            createdBy: 'admin'
        }))
    };

    const filename = `complete_user_locks_${userAddress.slice(0, 10)}.json`;
    await fs.writeFile(filename, JSON.stringify(data, null, 2));
    console.log(`\n✅ Exported to ${filename}`);
}

/**
 * Main execution
 */
async function main() {
    try {
        console.log('🚀 Victory Token Locker - Complete User Lock Fetcher\n');
        console.log('═'.repeat(70));
        console.log(`🌐 Network: ${NETWORK}`);
        console.log(`📦 Package: ${PACKAGE_ID}`);
        console.log('═'.repeat(70));

        // Test connection
        const connected = await testConnection();
        if (!connected) {
            console.error('❌ Cannot proceed without connection\n');
            process.exit(1);
        }

        // Fetch ALL locks (both user-created and admin-created)
        const result = await fetchAllUserLocks(TARGET_USER);

        // Display results
        displayAllLocks(result, TARGET_USER);

        // Export to JSON
        await exportToJSON(result, TARGET_USER);

        console.log('\n✨ Done!\n');

    } catch (error) {
        console.error('\n❌ Fatal Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run
main();