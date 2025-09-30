import fs from 'fs/promises';
import path from 'path';
import ical from 'ical';

// Import shared utilities
import { loadCompetitionData } from '../lib/competition-utils.js';
import { logSuccess, logWarning, logInfo } from '../lib/error-utils.js';
import { TEMP_DIR, COMPETITIONS_FILE } from '../lib/config.js';

/**
 * Parse an iCal file and find the latest event date
 * @param {string} icalPath - Path to the iCal file
 * @returns {Promise<Date|null>} - Latest event date or null if no events found
 */
async function getLatestEventDate(icalPath) {
    try {
        const icalData = await fs.readFile(icalPath, 'utf8');
        const parsedCal = ical.parseICS(icalData);

        let latestDate = null;

        for (const eventId in parsedCal) {
            const event = parsedCal[eventId];

            if (event.type === 'VEVENT' && event.start) {
                const eventDate = new Date(event.start);

                if (!latestDate || eventDate > latestDate) {
                    latestDate = eventDate;
                }
            }
        }

        return latestDate;
    } catch (error) {
        logWarning(`Error reading iCal file ${icalPath}: ${error.message}`);
        return null;
    }
}

/**
 * Check if a competition is active based on its processed calendar file
 * @param {Object} competition - Competition object
 * @returns {Promise<boolean>} - True if competition is active
 */
async function isCompetitionActive(competition) {
    const processedDir = path.join(TEMP_DIR, 'processed');

    // Generate the expected processed file name
    const fileName = `${competition.name.replace(/[^a-z0-9]/gi, '_')}_processed.ics`;
    const filePath = path.join(processedDir, fileName);

    try {
        // Check if processed file exists
        await fs.access(filePath);

        // Get the latest event date from the processed calendar
        const latestDate = await getLatestEventDate(filePath);

        if (!latestDate) {
            logWarning(`No events found in ${fileName}`);
            return false; // No events = inactive
        }

        const now = new Date();
        const timeDiff = latestDate - now;
        const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

        // Consider competition active if the latest event is within 7 days past or in the future
        const isActive = daysDiff >= -7;

        logInfo(`${competition.name}: Latest event ${latestDate.toDateString()}, ${daysDiff} days from now, ${isActive ? 'ACTIVE' : 'INACTIVE'}`);

        return isActive;

    } catch (error) {
        logWarning(`Processed file not found for ${competition.name}: ${fileName}`);
        return true; // If we can't determine, assume active to be safe
    }
}

/**
 * Update competitions.json with active status flags
 */
async function updateCompetitionStatus() {
    try {
        logInfo('Loading competitions data...');
        const competitionData = await loadCompetitionData();

        logInfo(`Found ${competitionData.competitions.length} competitions`);

        let updatedCount = 0;
        let activeCount = 0;
        let inactiveCount = 0;

        // Check each competition's status
        for (const competition of competitionData.competitions) {
            const wasActive = competition.isActive;
            const isActive = await isCompetitionActive(competition);

            if (wasActive !== isActive || competition.isActive === undefined) {
                competition.isActive = isActive;
                competition.statusUpdatedAt = new Date().toISOString();
                updatedCount++;
            }

            if (isActive) {
                activeCount++;
            } else {
                inactiveCount++;
            }
        }

        // Update the main metadata
        competitionData.lastStatusUpdate = new Date().toISOString();
        competitionData.activeCompetitions = activeCount;
        competitionData.inactiveCompetitions = inactiveCount;

        // Save the updated competitions file
        await fs.writeFile(COMPETITIONS_FILE, JSON.stringify(competitionData, null, 2), 'utf8');

        logSuccess(`Updated ${updatedCount} competition statuses`);
        logInfo(`Active competitions: ${activeCount}`);
        logInfo(`Inactive competitions: ${inactiveCount}`);

        return {
            total: competitionData.competitions.length,
            updated: updatedCount,
            active: activeCount,
            inactive: inactiveCount
        };

    } catch (error) {
        logWarning(`Error updating competition status: ${error.message}`);
        throw error;
    }
}

/**
 * Main execution function
 */
async function main() {
    console.log('========================================');
    console.log('Hockey Victoria Competition Status Updater');
    console.log(`Started at: ${new Date().toISOString()}`);
    console.log('========================================\n');

    try {
        const results = await updateCompetitionStatus();

        console.log('\n========================================');
        console.log('Status Update Summary:');
        console.log(`  Total competitions: ${results.total}`);
        console.log(`  Updated statuses: ${results.updated}`);
        console.log(`  Currently active: ${results.active}`);
        console.log(`  Currently inactive: ${results.inactive}`);
        console.log('========================================');

    } catch (error) {
        console.error('❌ Failed to update competition status:', error.message);
        process.exit(1);
    }
}

// Run if called directly
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
    main();
}

export { updateCompetitionStatus, isCompetitionActive };