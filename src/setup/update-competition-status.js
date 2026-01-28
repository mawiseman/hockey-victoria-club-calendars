import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
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
 * @returns {Promise<{isActive: boolean, missingFile: boolean, latestDate: Date|null, daysDiff: number|null}>}
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
            return { isActive: false, missingFile: false, latestDate: null, daysDiff: null };
        }

        const now = new Date();
        const timeDiff = latestDate - now;
        const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

        // Consider competition active if the latest event is within 7 days past or in the future
        const isActive = daysDiff >= -7;

        logInfo(`${competition.name}: Latest event ${latestDate.toDateString()}, ${daysDiff} days from now, ${isActive ? 'ACTIVE' : 'INACTIVE'}`);

        return { isActive, missingFile: false, latestDate, daysDiff };

    } catch (error) {
        // File not found - return special status
        return { isActive: null, missingFile: true, latestDate: null, daysDiff: null };
    }
}

/**
 * Prompt user for confirmation about missing file competitions
 * @param {Array} competitions - List of competitions with missing files
 * @returns {Promise<boolean>} - True if user confirms to mark as inactive
 */
async function confirmMissingFileInactive(competitions) {
    console.log('\n========================================');
    console.log('COMPETITIONS WITH MISSING ICS FILES');
    console.log('========================================\n');

    console.log('The following competitions have no processed .ics files:');
    console.log('(This may indicate the competition no longer exists on Hockey Victoria)\n');

    competitions.forEach((comp, index) => {
        console.log(`  ${index + 1}. ${comp.name}`);
        if (comp.category) {
            console.log(`     Category: ${comp.category}`);
        }
    });

    console.log('');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(
            `Mark these ${competitions.length} competition(s) as INACTIVE? (yes/no): `,
            (answer) => {
                rl.close();
                resolve(answer.trim().toLowerCase() === 'yes');
            }
        );
    });
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
        const missingFileCompetitions = [];

        // First pass: Check each competition's status
        for (const competition of competitionData.competitions) {
            const result = await isCompetitionActive(competition);

            if (result.missingFile) {
                // Collect competitions with missing files for later confirmation
                missingFileCompetitions.push(competition);
            } else {
                // Update status based on calendar data
                const wasActive = competition.isActive;
                const isActive = result.isActive;

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
        }

        // Handle competitions with missing files
        if (missingFileCompetitions.length > 0) {
            const markInactive = await confirmMissingFileInactive(missingFileCompetitions);

            for (const competition of missingFileCompetitions) {
                if (markInactive) {
                    const wasActive = competition.isActive;
                    if (wasActive !== false) {
                        competition.isActive = false;
                        competition.statusUpdatedAt = new Date().toISOString();
                        updatedCount++;
                    }
                    inactiveCount++;
                    logInfo(`${competition.name}: Marked INACTIVE (missing .ics file)`);
                } else {
                    // Keep current status or default to active
                    if (competition.isActive === undefined) {
                        competition.isActive = true;
                        competition.statusUpdatedAt = new Date().toISOString();
                        updatedCount++;
                    }
                    if (competition.isActive) {
                        activeCount++;
                    } else {
                        inactiveCount++;
                    }
                    logWarning(`${competition.name}: Kept as ${competition.isActive ? 'ACTIVE' : 'INACTIVE'} (missing .ics file, user declined)`);
                }
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
            inactive: inactiveCount,
            missingFiles: missingFileCompetitions.length
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
        if (results.missingFiles > 0) {
            console.log(`  Missing .ics files: ${results.missingFiles}`);
        }
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