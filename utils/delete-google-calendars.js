import { google } from 'googleapis';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const CALENDAR_PREFIX = 'FHC ';

/**
 * Initialize Google Calendar API client
 */
async function initializeCalendarClient() {
    const auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || 'service-account-key.json',
        scopes: SCOPES,
    });

    const authClient = await auth.getClient();
    const calendar = google.calendar({ version: 'v3', auth: authClient });
    
    return calendar;
}

/**
 * Get all calendars from Google
 */
async function getCalendars(calendar, filterFHC = false) {
    try {
        const response = await calendar.calendarList.list({
            maxResults: 250,
            showDeleted: false,
            showHidden: false
        });
        
        let calendars = response.data.items || [];
        
        if (filterFHC) {
            calendars = calendars.filter(cal => 
                cal.summary && cal.summary.startsWith(CALENDAR_PREFIX)
            );
        }
        
        return calendars;
    } catch (error) {
        console.error('Error fetching calendars:', error.message);
        return [];
    }
}

/**
 * Delete a specific calendar
 */
async function deleteCalendar(calendar, calendarId, calendarName) {
    try {
        await calendar.calendars.delete({
            calendarId: calendarId
        });
        console.log(`✅ Deleted: ${calendarName}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to delete ${calendarName}: ${error.message}`);
        return false;
    }
}

/**
 * Create readline interface for user input
 */
function createReadlineInterface() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

/**
 * Ask for user confirmation
 */
async function askConfirmation(question) {
    const rl = createReadlineInterface();
    
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
    });
}

/**
 * Select calendars interactively
 */
async function selectCalendarsInteractively(calendars) {
    console.log('\n📋 Available calendars:');
    calendars.forEach((cal, index) => {
        console.log(`${index + 1}. ${cal.summary || cal.id}`);
    });
    
    console.log('\n📝 Enter calendar numbers to delete (comma-separated), or:');
    console.log('   - "all" to delete all listed calendars');
    console.log('   - "cancel" to abort');
    
    const rl = createReadlineInterface();
    
    return new Promise((resolve) => {
        rl.question('\nYour selection: ', (answer) => {
            rl.close();
            
            if (answer.toLowerCase() === 'cancel') {
                resolve([]);
            } else if (answer.toLowerCase() === 'all') {
                resolve(calendars);
            } else {
                const indices = answer.split(',')
                    .map(s => parseInt(s.trim()) - 1)
                    .filter(i => i >= 0 && i < calendars.length);
                
                resolve(indices.map(i => calendars[i]));
            }
        });
    });
}

/**
 * Delete calendars by name pattern
 */
async function deleteCalendarsByName(pattern) {
    console.log(`🔍 Searching for calendars matching: "${pattern}"...\n`);
    
    try {
        const calendar = await initializeCalendarClient();
        const allCalendars = await getCalendars(calendar);
        
        // Filter calendars by pattern
        const matchingCalendars = allCalendars.filter(cal => {
            if (!cal.summary) return false;
            return cal.summary.toLowerCase().includes(pattern.toLowerCase());
        });
        
        if (matchingCalendars.length === 0) {
            console.log(`📭 No calendars found matching "${pattern}"`);
            return;
        }
        
        console.log(`📅 Found ${matchingCalendars.length} matching calendar(s):`);
        matchingCalendars.forEach((cal, index) => {
            console.log(`${index + 1}. ${cal.summary}`);
            console.log(`   ID: ${cal.id}`);
        });
        
        const confirmed = await askConfirmation(
            `\n⚠️  Are you sure you want to delete ${matchingCalendars.length} calendar(s)? (y/n): `
        );
        
        if (!confirmed) {
            console.log('❌ Deletion cancelled');
            return;
        }
        
        console.log('\n🗑️  Deleting calendars...');
        let deleted = 0;
        let failed = 0;
        
        for (const cal of matchingCalendars) {
            const success = await deleteCalendar(calendar, cal.id, cal.summary);
            if (success) deleted++;
            else failed++;
            
            // Add delay between deletions
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        console.log(`\n📊 Summary:`);
        console.log(`   ✅ Successfully deleted: ${deleted}`);
        if (failed > 0) {
            console.log(`   ❌ Failed to delete: ${failed}`);
        }
        
    } catch (error) {
        console.error(`💥 Error: ${error.message}`);
    }
}

/**
 * Delete all FHC calendars
 */
async function deleteAllCompetitionCalendars() {
    console.log('🔍 Finding all Competition calendars...\n');
    
    try {
        const calendar = await initializeCalendarClient();
        const fhcCalendars = await getCalendars(calendar, true);
        
        if (fhcCalendars.length === 0) {
            console.log('📭 No Competition calendars found');
            return;
        }
        
        console.log(`📅 Found ${fhcCalendars.length} Competition calendar(s):`);
        fhcCalendars.forEach((cal, index) => {
            console.log(`${index + 1}. ${cal.summary}`);
        });
        
        const confirmed = await askConfirmation(
            `\n⚠️  WARNING: This will delete ALL ${fhcCalendars.length} Competition calendars! Are you sure? (y/n): `
        );
        
        if (!confirmed) {
            console.log('❌ Deletion cancelled');
            return;
        }
        
        const doubleConfirmed = await askConfirmation(
            `\n⚠️  FINAL CONFIRMATION: Delete all ${fhcCalendars.length} Competition calendars? This cannot be undone! (y/n): `
        );
        
        if (!doubleConfirmed) {
            console.log('❌ Deletion cancelled');
            return;
        }
        
        console.log('\n🗑️  Deleting all Competition calendars...');
        let deleted = 0;
        let failed = 0;
        
        for (const cal of fhcCalendars) {
            const success = await deleteCalendar(calendar, cal.id, cal.summary);
            if (success) deleted++;
            else failed++;
            
            // Add delay between deletions
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        console.log(`\n📊 Summary:`);
        console.log(`   ✅ Successfully deleted: ${deleted}`);
        if (failed > 0) {
            console.log(`   ❌ Failed to delete: ${failed}`);
        }
        
    } catch (error) {
        console.error(`💥 Error: ${error.message}`);
    }
}

/**
 * Interactive deletion mode
 */
async function deleteCalendarsInteractive() {
    console.log('🔍 Fetching all calendars...\n');
    
    try {
        const calendar = await initializeCalendarClient();
        const allCalendars = await getCalendars(calendar);
        
        if (allCalendars.length === 0) {
            console.log('📭 No calendars found');
            return;
        }
        
        // Group calendars
        const fhcCalendars = allCalendars.filter(cal => 
            cal.summary && cal.summary.startsWith(CALENDAR_PREFIX)
        );
        const otherCalendars = allCalendars.filter(cal => 
            !cal.summary || !cal.summary.startsWith(CALENDAR_PREFIX)
        );
        
        console.log(`📊 Found ${allCalendars.length} total calendars:`);
        console.log(`   🏒 Competition calendars: ${fhcCalendars.length}`);
        console.log(`   📚 Other calendars: ${otherCalendars.length}`);
        
        console.log('\n🎯 What would you like to delete?');
        console.log('1. All Competition calendars');
        console.log('2. Select specific Competition calendars');
        console.log('3. Select from all calendars');
        console.log('4. Cancel');
        
        const rl = createReadlineInterface();
        const choice = await new Promise((resolve) => {
            rl.question('\nEnter your choice (1-4): ', (answer) => {
                rl.close();
                resolve(answer);
            });
        });
        
        let selectedCalendars = [];
        
        switch(choice) {
            case '1':
                selectedCalendars = fhcCalendars;
                break;
            case '2':
                if (fhcCalendars.length === 0) {
                    console.log('📭 No Competition calendars to select from');
                    return;
                }
                selectedCalendars = await selectCalendarsInteractively(fhcCalendars);
                break;
            case '3':
                selectedCalendars = await selectCalendarsInteractively(allCalendars);
                break;
            default:
                console.log('❌ Cancelled');
                return;
        }
        
        if (selectedCalendars.length === 0) {
            console.log('❌ No calendars selected');
            return;
        }
        
        console.log(`\n📋 Selected ${selectedCalendars.length} calendar(s) for deletion:`);
        selectedCalendars.forEach((cal, index) => {
            console.log(`${index + 1}. ${cal.summary || cal.id}`);
        });
        
        const confirmed = await askConfirmation(
            `\n⚠️  Delete ${selectedCalendars.length} calendar(s)? This cannot be undone! (y/n): `
        );
        
        if (!confirmed) {
            console.log('❌ Deletion cancelled');
            return;
        }
        
        console.log('\n🗑️  Deleting calendars...');
        let deleted = 0;
        let failed = 0;
        
        for (const cal of selectedCalendars) {
            const success = await deleteCalendar(calendar, cal.id, cal.summary || cal.id);
            if (success) deleted++;
            else failed++;
            
            // Add delay between deletions
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        console.log(`\n📊 Summary:`);
        console.log(`   ✅ Successfully deleted: ${deleted}`);
        if (failed > 0) {
            console.log(`   ❌ Failed to delete: ${failed}`);
        }
        
    } catch (error) {
        console.error(`💥 Error: ${error.message}`);
    }
}

/**
 * Main execution
 */
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        // Interactive mode
        await deleteCalendarsInteractive();
    } else if (args[0] === '--all-competition') {
        // Delete all FHC calendars
        await deleteAllCompetitionCalendars();
    } else if (args[0] === '--name' && args[1]) {
        // Delete by name pattern
        await deleteCalendarsByName(args[1]);
    } else {
        console.log('📖 Usage:');
        console.log('  npm run delete-calendars              # Interactive mode');
        console.log('  npm run delete-calendars -- --all-competition # Delete all Competition calendars');
        console.log('  npm run delete-calendars -- --name "pattern" # Delete by name pattern');
        console.log('\nExamples:');
        console.log('  npm run delete-calendars -- --name "Premier League"');
        console.log('  npm run delete-calendars -- --name "2025"');
    }
}

// Run the script if called directly
if (process.argv[1] === __filename) {
    main();
}

export { deleteAllCompetitionCalendars, deleteCalendarsByName, deleteCalendarsInteractive };