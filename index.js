const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');

const NETWORK = 'testnet';
const TARGET_USER = '0x11d00b1f0594da0aedc3dab291e619cea33e5cfcd3554738bfc1dd0375b65b56';
const TOKEN_LOCKER_OBJECT_ID = '0x8b4d6227a6b849a793b53619085120aed152d41104a6133b85034fa8ff4c7077';

const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

/**
 * ✅ Fetch user locks directly with correct parsing
 */
async function fetchUserLocksDirectly(userAddress, lockPeriod) {
    const periodNames = { 7: '1 Week', 90: '3 Months', 365: '1 Year', 1095: '3 Years' };
    console.log(`🔍 ${periodNames[lockPeriod]}...`);
    
    try {
        const tableFieldName = lockPeriod === 7 ? 'week_locks' :
                               lockPeriod === 90 ? 'three_month_locks' :
                               lockPeriod === 365 ? 'year_locks' : 
                               'three_year_locks';

        const lockerObject = await client.getObject({
            id: TOKEN_LOCKER_OBJECT_ID,
            options: { showContent: true }
        });

        if (!lockerObject.data?.content?.fields) {
            throw new Error('TokenLocker object not found');
        }

        const fields = lockerObject.data.content.fields;
        const tableId = fields[tableFieldName]?.fields?.id?.id;
        
        if (!tableId) {
            console.log(`   No table found\n`);
            return [];
        }

        const userLocks = await client.getDynamicFieldObject({
            parentId: tableId,
            name: {
                type: 'address',
                value: userAddress
            }
        });

        if (userLocks.data?.content?.fields?.value) {
            const locksArray = userLocks.data.content.fields.value;
            
            const parsedLocks = locksArray.map(lockItem => {
                const fields = lockItem.fields;
                return {
                    id: fields.id,
                    amount: fields.amount,
                    lockPeriod: fields.lock_period,
                    lockEnd: fields.lock_end,
                    stakeTimestamp: fields.stake_timestamp,
                    lastVictoryClaimTimestamp: fields.last_victory_claim_timestamp,
                    totalVictoryClaimed: fields.total_victory_claimed,
                    lastSuiEpochClaimed: fields.last_sui_epoch_claimed,
                    claimedSuiEpochs: fields.claimed_sui_epochs || []
                };
            });

            console.log(`   ✅ ${parsedLocks.length} locks found\n`);
            return parsedLocks;
        }

        console.log(`   No locks found\n`);
        return [];

    } catch (error) {
        if (error.message.includes('Could not find') || error.message.includes('not found')) {
            console.log(`   No locks (user not in table)\n`);
            return [];
        }
        console.error(`   ❌ Error: ${error.message}\n`);
        return [];
    }
}

/**
 * 🚀 Get ALL user locks
 */
async function getAllUserLocks(userAddress) {
    console.log(`\n🔍 Fetching locks for: ${userAddress}\n`);
    console.log('═'.repeat(70));

    const periods = [7, 90, 365, 1095];
    const allLocks = {};

    for (const period of periods) {
        const locks = await fetchUserLocksDirectly(userAddress, period);
        const periodName = { 7: '1 Week', 90: '3 Months', 365: '1 Year', 1095: '3 Years' }[period];
        allLocks[periodName] = locks;
    }

    console.log('═'.repeat(70));
    return allLocks;
}

/**
 * Format amount
 */
function formatAmount(amount) {
    return (Number(amount) / 1e6).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

/**
 * Format date safely
 */
function formatDate(timestamp) {
    const ts = Number(timestamp);
    
    // Check if timestamp is reasonable (after year 2000)
    if (ts < 946684800) { // Jan 1, 2000
        return `Invalid (${ts})`;
    }
    
    const date = new Date(ts * 1000);
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * 🔧 Calculate actual unlock date from stake + period
 */
function calculateActualUnlockDate(stakeTimestamp, lockPeriodDays) {
    const SECONDS_PER_DAY = 86400;
    const stakeTs = Number(stakeTimestamp);
    const unlockTs = stakeTs + (Number(lockPeriodDays) * SECONDS_PER_DAY);
    
    const date = new Date(unlockTs * 1000);
    return {
        timestamp: unlockTs,
        formatted: date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    };
}

/**
 * Display locks with corrected unlock dates
 */
function displayLocks(allLocks, userAddress) {
    console.log('\n📊 USER LOCK SUMMARY');
    console.log('═'.repeat(70));
    console.log(`\n👤 User: ${userAddress}\n`);

    let totalAmount = 0;
    let totalCount = 0;

    // Summary
    Object.entries(allLocks).forEach(([period, locks]) => {
        const periodAmount = locks.reduce((sum, lock) => sum + Number(lock.amount), 0);
        totalAmount += periodAmount;
        totalCount += locks.length;
        
        if (locks.length > 0) {
            console.log(`${period}: ${locks.length} locks | ${formatAmount(periodAmount)} VICTORY`);
        }
    });

    console.log('\n─'.repeat(70));
    console.log(`💎 Total: ${totalCount} locks | ${formatAmount(totalAmount)} VICTORY`);
    console.log('─'.repeat(70));

    // Detailed locks
    Object.entries(allLocks).forEach(([period, locks]) => {
        if (locks.length === 0) return;

        console.log(`\n📦 ${period.toUpperCase()}`);
        console.log('─'.repeat(70));

        locks.forEach((lock, i) => {
            const now = Date.now() / 1000;
            
            // ✅ FIX: Calculate actual unlock from stake + period
            const actualUnlock = calculateActualUnlockDate(lock.stakeTimestamp, lock.lockPeriod);
            const isExpired = now > actualUnlock.timestamp;
            const status = isExpired ? '🔓 Unlocked' : '🔒 Locked';
            
            // Check if stored lock_end seems invalid
            const storedLockEnd = Number(lock.lockEnd);
            const isStoredInvalid = storedLockEnd < 946684800; // Before year 2000

            console.log(`\n${i + 1}. Lock ID: ${lock.id} ${status}`);
            console.log(`   💰 Amount: ${formatAmount(lock.amount)} VICTORY`);
            console.log(`   📅 Staked: ${formatDate(lock.stakeTimestamp)}`);
            console.log(`   📅 Unlock: ${actualUnlock.formatted}`);
            
            if (isStoredInvalid) {
                console.log(`   ⚠️  (Stored lock_end: ${storedLockEnd} - testnet config issue)`);
            }
            
            console.log(`   🎁 Victory Claimed: ${formatAmount(lock.totalVictoryClaimed)} VICTORY`);
            console.log(`   💧 Last SUI Epoch: ${lock.lastSuiEpochClaimed}`);
            console.log(`   📊 Claimed Epochs: ${lock.claimedSuiEpochs.length}`);
            
            // Time remaining
            if (!isExpired) {
                const timeLeft = actualUnlock.timestamp - now;
                const daysLeft = Math.floor(timeLeft / 86400);
                const hoursLeft = Math.floor((timeLeft % 86400) / 3600);
                console.log(`   ⏰ Time Left: ${daysLeft} days, ${hoursLeft} hours`);
            }
        });
    });
}

/**
 * Export to JSON with corrected dates
 */
async function exportToJSON(allLocks, userAddress) {
    const fs = require('fs').promises;
    
    const flatLocks = [];
    Object.entries(allLocks).forEach(([period, locks]) => {
        locks.forEach(lock => {
            const actualUnlock = calculateActualUnlockDate(lock.stakeTimestamp, lock.lockPeriod);
            const now = Date.now() / 1000;
            
            flatLocks.push({
                lockId: lock.id,
                period,
                amount: lock.amount,
                amountFormatted: formatAmount(lock.amount),
                lockPeriodDays: lock.lockPeriod,
                stakeTimestamp: lock.stakeTimestamp,
                stakeDate: formatDate(lock.stakeTimestamp),
                actualUnlockTimestamp: actualUnlock.timestamp,
                actualUnlockDate: actualUnlock.formatted,
                storedLockEnd: lock.lockEnd,
                isExpired: now > actualUnlock.timestamp,
                totalVictoryClaimed: lock.totalVictoryClaimed,
                lastSuiEpochClaimed: lock.lastSuiEpochClaimed,
                claimedSuiEpochs: lock.claimedSuiEpochs
            });
        });
    });

    const data = {
        user: userAddress,
        fetchedAt: new Date().toISOString(),
        totalLocks: flatLocks.length,
        totalAmount: flatLocks.reduce((sum, l) => sum + Number(l.amount), 0),
        locks: flatLocks
    };

    const filename = `user_locks_${userAddress.slice(0, 10)}.json`;
    await fs.writeFile(filename, JSON.stringify(data, null, 2));
    console.log(`\n✅ Exported to ${filename}`);
}

/**
 * Export to CSV
 */
async function exportToCSV(allLocks, userAddress) {
    const fs = require('fs').promises;
    
    let csv = 'Lock ID,Period,Amount,Stake Date,Unlock Date,Victory Claimed,Last SUI Epoch,Status\n';
    
    Object.entries(allLocks).forEach(([period, locks]) => {
        locks.forEach(lock => {
            const actualUnlock = calculateActualUnlockDate(lock.stakeTimestamp, lock.lockPeriod);
            const now = Date.now() / 1000;
            const isExpired = now > actualUnlock.timestamp;
            const status = isExpired ? 'Unlocked' : 'Locked';
            
            csv += `${lock.id},${period},${lock.amount},${formatDate(lock.stakeTimestamp)},${actualUnlock.formatted},${lock.totalVictoryClaimed},${lock.lastSuiEpochClaimed},${status}\n`;
        });
    });

    const filename = `user_locks_${userAddress.slice(0, 10)}.csv`;
    await fs.writeFile(filename, csv);
    console.log(`✅ Exported to ${filename}`);
}

/**
 * Main
 */
async function main() {
    try {
        console.log('🚀 Victory Token Locker - Direct State Query');
        console.log(`🌐 Network: ${NETWORK}`);
        console.log(`📦 Locker: ${TOKEN_LOCKER_OBJECT_ID}`);

        const locks = await getAllUserLocks(TARGET_USER);
        displayLocks(locks, TARGET_USER);
        
        await exportToJSON(locks, TARGET_USER);
        await exportToCSV(locks, TARGET_USER);

        console.log('\n✨ Done!\n');

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

main();