import fs from 'fs/promises';
import readline from 'readline';
import { google } from 'googleapis';
import path from 'path';

// Import shared utilities
import { loadCompetitionData } from '../lib/competition-utils.js';
import { COMPETITIONS_FILE } from '../lib/config.js';
import { logSuccess, logWarning, logInfo, getDetailedError } from '../lib/error-utils.js';
import { authenticateGoogle } from '../lib/google-auth.js';

/**
 * Display inactive competitions with details
 */
function displayInactiveCompetitions(competitions) {
    console.log('\n========================================');
    console.log('INACTIVE COMPETITIONS');
    console.log('========================================\n');

    if (competitions.length === 0) {
        console.log('✅ No inactive competitions found.');
        return;
    }

    console.log(`Found ${competitions.length} inactive competition(s):\n`);

    competitions.forEach((comp, index) => {
        console.log(`${index + 1}. ${comp.name}`);
        console.log(`   Category: ${comp.category || 'N/A'}`);

        if (comp.googleCalendar && comp.googleCalendar.publicUrl) {
            console.log(`   URL: ${comp.googleCalendar.publicUrl}`);
        } else {
            console.log(`   URL: Not configured`);
        }

        console.log('');
    });
}

/**
 * Prompt user for confirmation
 */
async function confirmDeletion(count) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(
            `\n⚠️  This will DELETE ${count} Google Calendar(s) and remove their entries from competitions.json.\n` +
            `This action CANNOT be undone!\n\n` +
            `Type 'DELETE' to confirm, or anything else to cancel: `,
            (answer) => {
                rl.close();
                resolve(answer.trim() === 'DELETE');
            }
        );
    });
}

/**
 * Delete a Google Calendar
 */
async function deleteGoogleCalendar(calendar, calendarId) {
    try {
        await calendar.calendars.delete({
            calendarId: calendarId
        });
        return { success: true };
    } catch (error) {
        const detailedError = getDetailedError(error);
        return { success: false, error: detailedError };
    }
}

/**
 * Delete inactive competitions
 */
async function deleteInactiveCompetitions(competitions) {
    console.log('\n========================================');
    console.log('DELETING INACTIVE COMPETITIONS');
    console.log('========================================\n');

    const calendar = await authenticateGoogle();
    const results = [];

    for (const comp of competitions) {
        console.log(`Processing: ${comp.name}`);

        let calendarDeleted = false;
        let calendarError = null;

        // Delete Google Calendar if it exists
        if (comp.googleCalendar && comp.googleCalendar.calendarId) {
            logInfo(`  Deleting Google Calendar: ${comp.googleCalendar.calendarId}`);
            const result = await deleteGoogleCalendar(calendar, comp.googleCalendar.calendarId);

            if (result.success) {
                logSuccess(`  ✓ Google Calendar deleted`);
                calendarDeleted = true;
            } else {
                logWarning(`  ✗ Failed to delete Google Calendar: ${result.error}`);
                calendarError = result.error;
            }
        } else {
            logInfo(`  No Google Calendar configured - skipping calendar deletion`);
            calendarDeleted = true; // Consider it "deleted" since there was nothing to delete
        }

        results.push({
            competition: comp,
            calendarDeleted,
            calendarError
        });

        console.log('');
    }

    return results;
}

/**
 * Remove competitions from competitions.json
 */
async function removeFromConfig(competitionsToRemove, allCompetitions) {
    const remainingCompetitions = allCompetitions.filter(
        comp => !competitionsToRemove.some(toRemove => toRemove.name === comp.name)
    );

    // Preserve the structure of the original file
    const competitionData = {
        competitions: remainingCompetitions
    };

    // Write back to file with pretty formatting
    await fs.writeFile(
        COMPETITIONS_FILE,
        JSON.stringify(competitionData, null, 2),
        'utf8'
    );

    return {
        original: allCompetitions.length,
        removed: competitionsToRemove.length,
        remaining: remainingCompetitions.length
    };
}

/**
 * Main function
 */
async function main() {
    try {
        console.log('\n========================================');
        console.log('Hockey Victoria - Cleanup Inactive Competitions');
        console.log(`Started at: ${new Date().toISOString()}`);
        console.log('========================================');

        // Load competitions
        logInfo('Loading competitions from config/competitions.json...');
        const competitionData = await loadCompetitionData();
        const allCompetitions = competitionData.competitions;

        // Filter to inactive competitions
        const inactiveCompetitions = allCompetitions.filter(comp => comp.isActive === false);

        // Display inactive competitions
        displayInactiveCompetitions(inactiveCompetitions);

        if (inactiveCompetitions.length === 0) {
            console.log('\n✅ No cleanup needed.');
            return;
        }

        // Confirm deletion
        const confirmed = await confirmDeletion(inactiveCompetitions.length);

        if (!confirmed) {
            console.log('\n❌ Deletion cancelled by user.');
            return;
        }

        console.log('\n✅ Deletion confirmed. Proceeding...');

        // Delete Google Calendars
        const deleteResults = await deleteInactiveCompetitions(inactiveCompetitions);

        // Check if any calendar deletions failed
        const failedDeletions = deleteResults.filter(r => !r.calendarDeleted);

        if (failedDeletions.length > 0) {
            console.log('\n⚠️  WARNING: Some Google Calendar deletions failed:');
            failedDeletions.forEach(result => {
                console.log(`   - ${result.competition.name}: ${result.calendarError}`);
            });

            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            const continueAnyway = await new Promise((resolve) => {
                rl.question(
                    '\nDo you want to remove these competitions from competitions.json anyway? (yes/no): ',
                    (answer) => {
                        rl.close();
                        resolve(answer.trim().toLowerCase() === 'yes');
                    }
                );
            });

            if (!continueAnyway) {
                console.log('\n❌ Cleanup cancelled. No competitions were removed from competitions.json.');
                return;
            }
        }

        // Remove from competitions.json
        logInfo('Removing competitions from competitions.json...');
        const configResult = await removeFromConfig(inactiveCompetitions, allCompetitions);

        console.log('\n========================================');
        console.log('CLEANUP SUMMARY');
        console.log('========================================\n');

        console.log(`Original competitions: ${configResult.original}`);
        console.log(`Removed competitions: ${configResult.removed}`);
        console.log(`Remaining competitions: ${configResult.remaining}`);

        const successfulCalendarDeletions = deleteResults.filter(r => r.calendarDeleted).length;
        console.log(`\nGoogle Calendars deleted: ${successfulCalendarDeletions}/${inactiveCompetitions.length}`);

        if (failedDeletions.length > 0) {
            console.log(`\n⚠️  ${failedDeletions.length} calendar deletion(s) failed (see details above)`);
        }

        logSuccess('\n✅ Cleanup completed successfully!');

        console.log('\n========================================');
        console.log(`Completed at: ${new Date().toISOString()}`);
        console.log('========================================');

    } catch (error) {
        console.error('\n❌ Fatal error:', error);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the main function
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});
