// Enhanced Epoch Eligibility Checker with Protocol Initialization Info
// This will fetch all epochs, check eligibility, and show when protocol was initialized

const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');

const CONSTANTS = {
    PACKAGE_ID: "0xefc1dc4d0c85becd7c4a255c00bd2caa478163aa69c16570df62e58edc51d8f4",
    TOKEN_LOCKER_ID: "0xf260053b8226345008ef356b2fd357b73c161e1dce086e53f8669bdb970eb9fe",
    RPC_URL: 'https://fullnode.mainnet.sui.io:443',
};

// Your lock data
const YOUR_LOCK = {
    lock_id: 1,
    lock_end: 1768996947,
    lock_period: 90, // days
    user: "0x39ee291682e829771ad0c3ed46ebc69a962b7c2f9e6477409b22616bcf21ac34"
};

// Calculate stake timestamp from lock_end
const SECONDS_IN_DAY = 86400;
const STAKE_TIMESTAMP = YOUR_LOCK.lock_end - (YOUR_LOCK.lock_period * SECONDS_IN_DAY);

console.log("\n🔍 EPOCH ELIGIBILITY CHECKER");
console.log("=".repeat(70));
console.log(`\nYour Lock Info:`);
console.log(`  Lock ID: ${YOUR_LOCK.lock_id}`);
console.log(`  Lock Period: ${YOUR_LOCK.lock_period} days`);
console.log(`  Lock End: ${YOUR_LOCK.lock_end} (${new Date(YOUR_LOCK.lock_end * 1000).toISOString()})`);
console.log(`  Stake Timestamp: ${STAKE_TIMESTAMP} (${new Date(STAKE_TIMESTAMP * 1000).toISOString()})`);
console.log("\n");

const client = new SuiClient({ url: CONSTANTS.RPC_URL });

async function checkEpochEligibility() {
    try {
        // First, fetch the TokenLocker object to see when protocol was initialized
        console.log("🚀 Fetching protocol initialization info...\n");
        
        try {
            const tokenLockerObj = await client.getObject({
                id: CONSTANTS.TOKEN_LOCKER_ID,
                options: { showContent: true, showPreviousTransaction: true }
            });
            
            if (tokenLockerObj.data) {
                console.log("📋 PROTOCOL INITIALIZATION");
                console.log("=".repeat(70));
                
                // Get creation transaction details
                const creationTx = tokenLockerObj.data.previousTransaction;
                if (creationTx) {
                    try {
                        const txDetails = await client.getTransactionBlock({
                            digest: creationTx,
                            options: { showEffects: true }
                        });
                        
                        const creationTimestamp = txDetails.timestampMs 
                            ? parseInt(txDetails.timestampMs) / 1000 
                            : null;
                        
                        if (creationTimestamp) {
                            console.log(`Protocol Initialized: ${new Date(creationTimestamp * 1000).toISOString()}`);
                            console.log(`Unix Timestamp: ${Math.floor(creationTimestamp)}`);
                            console.log(`Creation Tx: ${creationTx}`);
                        }
                    } catch (txError) {
                        console.log(`⚠️  Could not fetch creation transaction details`);
                    }
                }
                
                console.log("=".repeat(70));
                console.log("\n");
            }
        } catch (objError) {
            console.log("⚠️  Could not fetch TokenLocker object details\n");
        }
        
        console.log("📡 Fetching all epoch events...\n");
        
        // Fetch all EpochCreated events
        let hasNextPage = true;
        let cursor = null;
        const allEpochs = [];
        const allEpochEvents = []; // Store full event data including timestamps
        
        while (hasNextPage) {
            const response = await client.queryEvents({
                query: {
                    MoveEventType: `${CONSTANTS.PACKAGE_ID}::victory_token_locker::EpochCreated`
                },
                cursor,
                limit: 50,
                order: 'ascending'
            });
            
            for (const event of response.data) {
                if (event.parsedJson) {
                    allEpochs.push(event.parsedJson);
                    allEpochEvents.push(event); // Store full event
                }
            }
            
            hasNextPage = response.hasNextPage;
            cursor = response.nextCursor;
        }
        
        console.log(`Found ${allEpochs.length} epochs\n`);
        
        // Show first epoch creation time (when epoch system started)
        if (allEpochEvents.length > 0) {
            const firstEpoch = allEpochEvents[0];
            const firstEpochTimestamp = firstEpoch.timestampMs 
                ? parseInt(firstEpoch.timestampMs) / 1000 
                : null;
            
            console.log("🎬 EPOCH SYSTEM STARTED");
            console.log("=".repeat(70));
            console.log(`First Epoch Created: ${firstEpochTimestamp ? new Date(firstEpochTimestamp * 1000).toISOString() : 'Unknown'}`);
            console.log(`First Epoch ID: ${firstEpoch.parsedJson.epoch_id}`);
            console.log(`First Week Start: ${new Date(parseInt(firstEpoch.parsedJson.week_start) * 1000).toISOString()}`);
            console.log(`Transaction: ${firstEpoch.id.txDigest}`);
            
            // Calculate time between your stake and first epoch
            if (firstEpochTimestamp) {
                const diffSeconds = STAKE_TIMESTAMP - firstEpochTimestamp;
                const diffDays = diffSeconds / 86400;
                
                if (diffSeconds > 0) {
                    console.log(`\n⏱️  You staked ${Math.abs(diffSeconds).toFixed(0)} seconds (${Math.abs(diffDays).toFixed(2)} days) AFTER epoch system started`);
                } else {
                    console.log(`\n⏱️  You staked ${Math.abs(diffSeconds).toFixed(0)} seconds (${Math.abs(diffDays).toFixed(2)} days) BEFORE epoch system started`);
                }
            }
            
            console.log("=".repeat(70));
            console.log("\n");
        }
        
        console.log("=".repeat(70));
        
        // Check eligibility for each epoch
        for (let i = 0; i < allEpochs.length; i++) {
            const epoch = allEpochs[i];
            const event = allEpochEvents[i];
            const epochId = parseInt(epoch.epoch_id);
            const weekStart = parseInt(epoch.week_start);
            const weekEnd = parseInt(epoch.week_end);
            
            // Get epoch creation timestamp
            const epochCreationTime = event.timestampMs 
                ? parseInt(event.timestampMs) / 1000 
                : null;
            
            // Eligibility check: stake_timestamp < week_start
            const isEligible = STAKE_TIMESTAMP < weekStart;
            
            // Also check if lock is still active when epoch ends
            const lockStillActive = YOUR_LOCK.lock_end >= weekEnd;
            
            const fullyEligible = isEligible && lockStillActive;
            
            console.log(`\n📅 EPOCH ${epochId}`);
            if (epochCreationTime) {
                console.log(`   Created: ${new Date(epochCreationTime * 1000).toISOString()}`);
            }
            console.log(`   Week Start: ${weekStart} (${new Date(weekStart * 1000).toISOString()})`);
            console.log(`   Week End:   ${weekEnd} (${new Date(weekEnd * 1000).toISOString()})`);
            
            // Check 1: Staked before epoch started?
            console.log(`\n   ✓ Check 1: Staked before epoch started?`);
            console.log(`      ${STAKE_TIMESTAMP} < ${weekStart}?`);
            if (isEligible) {
                const diff = weekStart - STAKE_TIMESTAMP;
                console.log(`      ✅ YES - Staked ${diff} seconds (${(diff / 86400).toFixed(2)} days) BEFORE epoch`);
            } else {
                const diff = STAKE_TIMESTAMP - weekStart;
                console.log(`      ❌ NO - Staked ${diff} seconds (${(diff / 86400).toFixed(2)} days) AFTER epoch started`);
            }
            
            // Check 2: Lock still active when epoch ends?
            console.log(`\n   ✓ Check 2: Lock still active when epoch ends?`);
            console.log(`      ${YOUR_LOCK.lock_end} >= ${weekEnd}?`);
            if (lockStillActive) {
                const diff = YOUR_LOCK.lock_end - weekEnd;
                console.log(`      ✅ YES - Lock ends ${diff} seconds (${(diff / 86400).toFixed(2)} days) AFTER epoch`);
            } else {
                const diff = weekEnd - YOUR_LOCK.lock_end;
                console.log(`      ❌ NO - Lock ends ${diff} seconds (${(diff / 86400).toFixed(2)} days) BEFORE epoch ends`);
            }
            
            // Final verdict
            console.log(`\n   🎯 ELIGIBILITY: ${fullyEligible ? '✅ ELIGIBLE' : '❌ INELIGIBLE'}`);
            
            if (!fullyEligible && !isEligible) {
                console.log(`   💡 Reason: You staked DURING the week (not before it started)`);
            } else if (!fullyEligible && !lockStillActive) {
                console.log(`   💡 Reason: Your lock expired before the epoch ended`);
            }
            
            console.log("-".repeat(70));
        }
        
        // Summary
        console.log("\n📊 SUMMARY");
        console.log("=".repeat(70));
        
        const eligibleEpochs = allEpochs.filter(epoch => {
            const weekStart = parseInt(epoch.week_start);
            const weekEnd = parseInt(epoch.week_end);
            return STAKE_TIMESTAMP < weekStart && YOUR_LOCK.lock_end >= weekEnd;
        });
        
        console.log(`\nTotal Epochs Created: ${allEpochs.length}`);
        console.log(`Epochs You're Eligible For: ${eligibleEpochs.length}`);
        console.log(`Ineligible Epochs: ${allEpochs.length - eligibleEpochs.length}`);
        
        if (eligibleEpochs.length > 0) {
            console.log(`\n✅ Eligible Epoch IDs: ${eligibleEpochs.map(e => e.epoch_id).join(', ')}`);
        }
        
        const ineligibleEpochs = allEpochs.filter(epoch => {
            const weekStart = parseInt(epoch.week_start);
            const weekEnd = parseInt(epoch.week_end);
            return !(STAKE_TIMESTAMP < weekStart && YOUR_LOCK.lock_end >= weekEnd);
        });
        
        if (ineligibleEpochs.length > 0) {
            console.log(`\n❌ Ineligible Epoch IDs: ${ineligibleEpochs.map(e => e.epoch_id).join(', ')}`);
        }
        
        // Check funding status for each epoch
        console.log("\n\n💰 CHECKING FUNDING STATUS FOR EACH EPOCH...");
        console.log("=".repeat(70));
        
        // Fetch WeeklyRevenueAdded events
        hasNextPage = true;
        cursor = null;
        const fundedEpochs = new Map();
        
        while (hasNextPage) {
            const response = await client.queryEvents({
                query: {
                    MoveEventType: `${CONSTANTS.PACKAGE_ID}::victory_token_locker::WeeklyRevenueAdded`
                },
                cursor,
                limit: 50,
                order: 'ascending'
            });
            
            for (const event of response.data) {
                if (event.parsedJson) {
                    const epochId = parseInt(event.parsedJson.epoch_id);
                    const suiAmount = event.parsedJson.total_week_revenue;
                    fundedEpochs.set(epochId, suiAmount);
                }
            }
            
            hasNextPage = response.hasNextPage;
            cursor = response.nextCursor;
        }
        
        console.log("\nFunded Epochs:");
        for (const epoch of allEpochs) {
            const epochId = parseInt(epoch.epoch_id);
            const suiAmount = fundedEpochs.get(epochId);
            
            if (suiAmount) {
                console.log(`  Epoch ${epochId}: ${parseInt(suiAmount) / 1000000000} SUI`);
            } else {
                console.log(`  Epoch ${epochId}: ⚠️  NOT FUNDED YET`);
            }
        }
        
        // Final Analysis
        console.log("\n\n🎯 FINAL ANALYSIS");
        console.log("=".repeat(70));
        
        for (const epoch of allEpochs) {
            const epochId = parseInt(epoch.epoch_id);
            const weekStart = parseInt(epoch.week_start);
            const weekEnd = parseInt(epoch.week_end);
            const isEligible = STAKE_TIMESTAMP < weekStart && YOUR_LOCK.lock_end >= weekEnd;
            const isFunded = fundedEpochs.has(epochId);
            const currentTime = Math.floor(Date.now() / 1000);
            const hasEnded = currentTime >= weekEnd;
            
            const canClaim = isEligible && isFunded && hasEnded;
            
            console.log(`\nEpoch ${epochId}:`);
            console.log(`  Eligible: ${isEligible ? '✅' : '❌'}`);
            console.log(`  Funded: ${isFunded ? '✅' : '❌'}`);
            console.log(`  Has Ended: ${hasEnded ? '✅' : '❌'}`);
            console.log(`  Can Claim: ${canClaim ? '✅ YES' : '❌ NO'}`);
            
            if (!isEligible) {
                console.log(`  🔍 WHY INELIGIBLE:`);
                if (STAKE_TIMESTAMP >= weekStart) {
                    console.log(`     - Staked at ${new Date(STAKE_TIMESTAMP * 1000).toISOString()}`);
                    console.log(`     - Epoch started at ${new Date(weekStart * 1000).toISOString()}`);
                    console.log(`     - You staked ${STAKE_TIMESTAMP - weekStart} seconds AFTER epoch started`);
                }
                if (YOUR_LOCK.lock_end < weekEnd) {
                    console.log(`     - Lock expires at ${new Date(YOUR_LOCK.lock_end * 1000).toISOString()}`);
                    console.log(`     - Epoch ends at ${new Date(weekEnd * 1000).toISOString()}`);
                    console.log(`     - Lock expires ${weekEnd - YOUR_LOCK.lock_end} seconds BEFORE epoch ends`);
                }
            }
        }
        
        console.log("\n" + "=".repeat(70));
        console.log("✅ Analysis Complete!");
        console.log("=".repeat(70) + "\n");
        
    } catch (error) {
        console.error("❌ Error:", error);
        throw error;
    }
}

// Run the check
checkEpochEligibility().catch(console.error);