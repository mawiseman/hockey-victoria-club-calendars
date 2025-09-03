import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Import shared utilities
import { initializeCalendarClient } from '../shared/google-auth.js';
import { loadCompetitionData, getCompetitionStats } from '../shared/competition-utils.js';
import { getCalendarPrefix, COMPETITIONS_FILE } from '../shared/config.js';
import { withErrorHandling, logSuccess, logInfo } from '../shared/error-utils.js';

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
 * List calendars in console format
 */
async function listCalendars(filterPrefix = null) {
    logInfo('Fetching Google Calendars...');
    
    // Initialize Google Calendar client
    const calendar = await initializeCalendarClient();
    logSuccess('Connected to Google Calendar API');
    
    // Get existing calendars
    const existingCalendars = await getExistingCalendars(calendar);
    
    // Filter by prefix if specified
    let calendarsToShow = existingCalendars;
    if (filterPrefix) {
        calendarsToShow = existingCalendars.filter(cal => 
            cal.summary && cal.summary.includes(filterPrefix)
        );
        logInfo(`Filtering calendars with prefix: "${filterPrefix}"`);
    }
    
    if (calendarsToShow.length === 0) {
        const message = filterPrefix ? 
            `No calendars found with prefix "${filterPrefix}"` : 
            'No calendars found';
        logInfo(message);
        return [];
    }
    
    console.log(`\n📅 Found ${calendarsToShow.length} calendar(s):`);
    console.log('='.repeat(80));
    
    calendarsToShow.forEach((cal, index) => {
        console.log(`${index + 1}. ${cal.summary || 'Untitled Calendar'}`);
        console.log(`   📅 ID: ${cal.id}`);
        console.log(`   🌐 URL: https://calendar.google.com/calendar/embed?src=${encodeURIComponent(cal.id)}`);
        console.log(`   📍 Timezone: ${cal.timeZone || 'Unknown'}`);
        console.log(`   👁️  Access: ${cal.accessRole || 'Unknown'}`);
        console.log('');
    });
    
    return calendarsToShow;
}

/**
 * Export calendars to JSON file
 */
async function exportCalendars(outputPath = 'exported-calendars.json', filterPrefix = null) {
    logInfo('Exporting calendars to JSON...');
    
    const calendars = await listCalendars(filterPrefix);
    
    if (calendars.length === 0) {
        logInfo('No calendars to export');
        return;
    }
    
    // Prepare export data
    const exportData = {
        exportedAt: new Date().toISOString(),
        totalCalendars: calendars.length,
        filterPrefix: filterPrefix || null,
        calendars: calendars.map(cal => ({
            id: cal.id,
            name: cal.summary || 'Untitled Calendar',
            description: cal.description || '',
            timezone: cal.timeZone || 'Unknown',
            accessRole: cal.accessRole || 'Unknown',
            publicUrl: `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(cal.id)}`,
            primary: cal.primary || false
        }))
    };
    
    // Write to file
    await fs.writeFile(outputPath, JSON.stringify(exportData, null, 2), 'utf8');
    
    logSuccess(`Exported ${calendars.length} calendars to ${outputPath}`);
    
    return exportData;
}

/**
 * Show calendar statistics
 */
async function showCalendarStats() {
    try {
        // Load competition data for comparison
        const competitionData = await loadCompetitionData();
        const stats = getCompetitionStats(competitionData.competitions);
        
        // Get Google calendars
        const calendar = await initializeCalendarClient();
        const existingCalendars = await getExistingCalendars(calendar);
        const calendarPrefix = await getCalendarPrefix();
        const fhcCalendars = existingCalendars.filter(cal => 
            cal.summary && cal.summary.includes(calendarPrefix)
        );
        
        console.log('\n📊 Calendar Statistics:');
        console.log('='.repeat(50));
        console.log(`Google Calendars (total): ${existingCalendars.length}`);
        console.log(`FHC Calendars: ${fhcCalendars.length}`);
        console.log('');
        console.log('Competition Data:');
        console.log(`  Total competitions: ${stats.total}`);
        console.log(`  With calendars: ${stats.withCalendars}`);
        console.log(`  Without calendars: ${stats.withoutCalendars}`);
        console.log('');
        console.log('By Category:');
        console.log(`  Men's: ${stats.categories.mens}`);
        console.log(`  Women's: ${stats.categories.womens}`);
        console.log(`  Midweek: ${stats.categories.midweek}`);
        console.log(`  Juniors: ${stats.categories.juniors}`);
        
    } catch (error) {
        logInfo('Competition data not available for statistics');
        const calendarPrefix = await getCalendarPrefix();
        await listCalendars(calendarPrefix);
    }
}

/**
 * Show help information
 */
function showHelp() {
    console.log(`
📋 Google Calendar Lister

Lists and exports Google Calendars created by this project

Usage:
  npm run list-calendars [-- options]
  npm run export-calendars [-- options]

Options:
  --filter <prefix>        Show only calendars with specific prefix (default: FHC prefix)
  --all                    Show all calendars (no filtering)
  --export <file>          Export to JSON file (default: exported-calendars.json)
  --stats                  Show calendar statistics
  --help, -h              Show this help message

Examples:
  npm run list-calendars                           # List FHC calendars
  npm run list-calendars -- --all                 # List all calendars
  npm run list-calendars -- --filter "Test"       # List calendars containing "Test"
  npm run list-calendars -- --stats               # Show calendar statistics
  npm run export-calendars                        # Export FHC calendars to JSON
  npm run export-calendars -- --all               # Export all calendars
  npm run export-calendars -- --export my.json    # Export to custom file

Output:
  • Console listing shows calendar names, IDs, and public URLs
  • JSON export includes detailed calendar metadata
  • Statistics compare Google Calendars with competition data

Requirements:
  • service-account-key.json must exist in project root
  • Service account must have calendar read permissions
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
        export: null,
        filter: null,
        stats: false
    };
    
    // Determine if this is export mode based on script name
    const isExportMode = process.argv[1].includes('export');
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--all') {
            options.all = true;
        } else if (arg === '--stats') {
            options.stats = true;
        } else if (arg === '--filter' && i + 1 < args.length) {
            options.filter = args[i + 1];
            i++; // Skip next argument
        } else if (arg === '--export' && i + 1 < args.length) {
            options.export = args[i + 1];
            i++; // Skip next argument
        }
    }
    
    // Set defaults based on mode
    if (isExportMode && options.export === null) {
        options.export = 'exported-calendars.json';
    }
    
    if (!options.all && options.filter === null) {
        const calendarPrefix = await getCalendarPrefix();
        options.filter = calendarPrefix;
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
    
    if (options.stats) {
        await showCalendarStats();
        return;
    }
    
    if (options.export) {
        const filterPrefix = options.all ? null : options.filter;
        await exportCalendars(options.export, filterPrefix);
    } else {
        const filterPrefix = options.all ? null : options.filter;
        await listCalendars(filterPrefix);
    }
}

// Run if called directly
if (process.argv[1] === __filename) {
    await withErrorHandling(main, 'list-calendars')();
}

export { listCalendars, exportCalendars, showCalendarStats };