import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Import shared utilities
import { initializeCalendarClient } from '../lib/google-auth.js';
import { loadCompetitionData, extractCalendarIds } from '../lib/competition-utils.js';
import { getCalendarPrefix, COMPETITIONS_FILE } from '../lib/config.js';
import { withErrorHandling, logSuccess, logWarning, logInfo, retryWithBackoff } from '../lib/error-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get all existing calendars from Google
 */
async function getExistingCalendars(calendar) {
    try {
        const response = await calendar.calendarList.list({
            maxResults: 250,
            showDeleted: false,
            showHidden: false
        });
        
        return response.data.items || [];
    } catch (error) {
        throw new Error(`Failed to fetch existing calendars: ${error.message}`);
    }
}

/**
 * Delete a Google Calendar
 */
async function deleteCalendar(calendar, calendarId, title) {
    try {
        await retryWithBackoff(async () => {
            await calendar.calendars.delete({
                calendarId: calendarId
            });
        });
        
        logSuccess(`Deleted: ${title}`);
        return true;
    } catch (error) {
        logWarning(`Failed to delete ${title}: ${error.message}`);
        return false;
    }
}

/**
 * Delete calendars by pattern matching
 */
async function deleteCalendarsByPattern(pattern = null) {
    if (!pattern) {
        pattern = await getCalendarPrefix();
    }
    logInfo(`Starting calendar deletion process for pattern: "${pattern}"`);
    
    // Initialize Google Calendar client
    const calendar = await initializeCalendarClient();
    logSuccess('Connected to Google Calendar API');
    
    // Get existing calendars
    logInfo('Fetching existing Google Calendars...');
    const existingCalendars = await getExistingCalendars(calendar);
    
    // Filter calendars that match the pattern
    const matchingCalendars = existingCalendars.filter(cal => 
        cal.summary && cal.summary.includes(pattern)
    );
    
    if (matchingCalendars.length === 0) {
        logInfo(`No calendars found matching pattern: "${pattern}"`);
        return { deleted: 0, failed: 0 };
    }
    
    console.log(`\n📋 Found ${matchingCalendars.length} calendars matching "${pattern}":`);
    matchingCalendars.forEach((cal, index) => {
        console.log(`${index + 1}. ${cal.summary}`);
        console.log(`   📅 ID: ${cal.id}`);
    });
    
    // Confirm deletion
    const readline = await import('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    const confirm = await new Promise(resolve => {
        rl.question(`\n⚠️  Are you sure you want to delete these ${matchingCalendars.length} calendars? (y/N): `, answer => {
            rl.close();
            resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
    });
    
    if (!confirm) {
        logInfo('Deletion cancelled by user');
        return { deleted: 0, failed: 0 };
    }
    
    // Delete calendars
    let deleted = 0;
    let failed = 0;
    
    for (let i = 0; i < matchingCalendars.length; i++) {
        const cal = matchingCalendars[i];
        logInfo(`Deleting (${i + 1}/${matchingCalendars.length}): ${cal.summary}`);
        
        const success = await deleteCalendar(calendar, cal.id, cal.summary);
        if (success) {
            deleted++;
        } else {
            failed++;
        }
        
        // Add delay between deletions
        if (i < matchingCalendars.length - 1) {
            logInfo('Waiting 1 second before next deletion...');
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    return { deleted, failed };
}

/**
 * Delete specific calendars by name
 */
async function deleteCalendarsByName(names) {
    logInfo(`Starting targeted calendar deletion for ${names.length} calendars`);
    
    // Initialize Google Calendar client
    const calendar = await initializeCalendarClient();
    logSuccess('Connected to Google Calendar API');
    
    // Get existing calendars
    logInfo('Fetching existing Google Calendars...');
    const existingCalendars = await getExistingCalendars(calendar);
    
    let deleted = 0;
    let failed = 0;
    let notFound = 0;
    
    for (const name of names) {
        const calendarToDelete = existingCalendars.find(cal => cal.summary === name);
        
        if (!calendarToDelete) {
            logWarning(`Calendar not found: ${name}`);
            notFound++;
            continue;
        }
        
        logInfo(`Deleting: ${name}`);
        const success = await deleteCalendar(calendar, calendarToDelete.id, name);
        if (success) {
            deleted++;
        } else {
            failed++;
        }
        
        // Add delay between deletions
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return { deleted, failed, notFound };
}

/**
 * Show help information
 */
function showHelp() {
    console.log(`
🗑️  Google Calendar Deleter

Deletes Google Calendars created by this project

Usage:
  npm run delete-calendars [-- options]

Options:
  --all                    Delete all calendars with FHC prefix
  --pattern <pattern>      Delete calendars matching custom pattern
  --name <name>            Delete specific calendar by exact name
  --help, -h              Show this help message

Examples:
  npm run delete-calendars -- --all                    # Delete all FHC calendars
  npm run delete-calendars -- --pattern "Test"         # Delete calendars containing "Test"
  npm run delete-calendars -- --name "FHC Test Cal"    # Delete specific calendar
  npm run delete-calendars -- --help                   # Show this help

Safety:
  • Interactive confirmation required before deletion
  • Deleted calendars cannot be recovered
  • Only calendars owned by the service account can be deleted

Requirements:
  • service-account-key.json must exist in project root
  • Service account must have calendar deletion permissions
`);
}

/**
 * Parse command line arguments
 */
function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        help: false,
        all: false,
        pattern: null,
        names: []
    };
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--all') {
            options.all = true;
        } else if (arg === '--pattern' && i + 1 < args.length) {
            options.pattern = args[i + 1];
            i++; // Skip next argument
        } else if (arg === '--name' && i + 1 < args.length) {
            options.names.push(args[i + 1]);
            i++; // Skip next argument
        }
    }
    
    return options;
}

/**
 * Main execution
 */
async function main() {
    const options = parseArguments();
    
    if (options.help) {
        showHelp();
        return;
    }
    
    let results;
    
    if (options.names.length > 0) {
        results = await deleteCalendarsByName(options.names);
        console.log(`\n📊 Deletion Summary:`);
        console.log(`   ✅ Deleted: ${results.deleted}`);
        console.log(`   ❌ Failed: ${results.failed}`);
        console.log(`   ❓ Not found: ${results.notFound}`);
    } else if (options.pattern || options.all) {
        const pattern = options.pattern || await getCalendarPrefix();
        results = await deleteCalendarsByPattern(pattern);
        console.log(`\n📊 Deletion Summary:`);
        console.log(`   ✅ Deleted: ${results.deleted}`);
        console.log(`   ❌ Failed: ${results.failed}`);
    } else {
        console.log('❌ No deletion method specified. Use --all, --pattern, or --name');
        console.log('Use --help for more information');
        process.exit(1);
    }
    
    if (results.deleted > 0) {
        logSuccess('Calendar deletion completed!');
    }
}

// Run if called directly
if (process.argv[1] === __filename) {
    await withErrorHandling(main, 'delete-calendars')();
}

export { deleteCalendarsByPattern, deleteCalendarsByName };