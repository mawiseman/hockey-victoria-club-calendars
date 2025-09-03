import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Import shared utilities
import { initializeCalendarClient } from '../lib/google-auth.js';
import { loadCompetitionData, getCompetitionsWithoutCalendars } from '../lib/competition-utils.js';
import { getCalendarPrefix, getClubName, COMPETITIONS_FILE, getCurrentTimestamp } from '../lib/config.js';
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
 * Create a new Google Calendar
 */
async function createCalendar(calendar, title, description) {
    const calendarResource = {
        summary: title,
        description: description,
        timeZone: 'Australia/Melbourne'
    };
    
    try {
        const response = await retryWithBackoff(async () => {
            return await calendar.calendars.insert({
                resource: calendarResource
            });
        });
        
        const calendarId = response.data.id;
        
        // Make the calendar public
        await retryWithBackoff(async () => {
            await calendar.acl.insert({
                calendarId: calendarId,
                resource: {
                    role: 'reader',
                    scope: {
                        type: 'default'
                    }
                }
            });
        });
        
        const publicUrl = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(calendarId)}`;
        const icalUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
        
        return {
            calendarId,
            publicUrl,
            icalUrl,
            title
        };
    } catch (error) {
        throw new Error(`Failed to create calendar "${title}": ${error.message}`);
    }
}

/**
 * Update competition data with calendar information
 */
async function updateCompetitionData(competitionData, calendarUpdates) {
    // Create a map of competition names to calendar data
    const calendarMap = new Map();
    calendarUpdates.forEach(update => {
        calendarMap.set(update.competitionName, {
            calendarId: update.calendarId,
            publicUrl: update.publicUrl,
            icalUrl: update.icalUrl,
            title: update.title,
            createdAt: getCurrentTimestamp()
        });
    });
    
    // Update competitions with calendar data
    competitionData.competitions.forEach(competition => {
        const calendarData = calendarMap.get(competition.name);
        if (calendarData) {
            competition.googleCalendar = calendarData;
        }
    });
    
    // Save updated data
    await fs.writeFile(COMPETITIONS_FILE, JSON.stringify(competitionData, null, 2), 'utf8');
}

/**
 * Main function to create Google Calendars
 */
async function createGoogleCalendars() {
    logInfo('Starting Google Calendar creation process...');
    
    // Load competition data
    const competitionData = await loadCompetitionData();
    const competitions = competitionData.competitions;
    
    logInfo(`Loaded ${competitions.length} competitions from ${COMPETITIONS_FILE}`);
    
    // Initialize Google Calendar client
    const calendar = await initializeCalendarClient();
    logSuccess('Connected to Google Calendar API');
    
    // Get existing calendars
    logInfo('Fetching existing Google Calendars...');
    const existingCalendars = await getExistingCalendars(calendar);
    
    // Process all competitions to ensure they have calendar details
    const competitionsToProcess = competitions;
    
    logInfo(`Processing ${competitionsToProcess.length} competitions to ensure calendar details are up to date`);
    
    const calendarUpdates = [];
    
    // Process each competition
    for (let i = 0; i < competitionsToProcess.length; i++) {
        const competition = competitionsToProcess[i];
        const calendarPrefix = await getCalendarPrefix();
        const calendarTitle = `${calendarPrefix}${competition.name}`;
        
        logInfo(`Processing (${i + 1}/${competitionsToProcess.length}): ${competition.name}`);
        
        try {
            // Check if competition already has calendar details in competitions.json
            if (competition.googleCalendar && competition.googleCalendar.calendarId) {
                // Verify the calendar still exists in Google
                const verifyCalendar = existingCalendars.find(cal => 
                    cal.id === competition.googleCalendar.calendarId
                );
                
                if (verifyCalendar) {
                    logInfo(`Calendar already configured and verified: ${calendarTitle}`);
                    
                    // Update with latest URLs including iCal if missing
                    const publicUrl = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(competition.googleCalendar.calendarId)}`;
                    const icalUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(competition.googleCalendar.calendarId)}/public/basic.ics`;
                    
                    calendarUpdates.push({
                        competitionName: competition.name,
                        calendarId: competition.googleCalendar.calendarId,
                        publicUrl: publicUrl,
                        icalUrl: icalUrl,
                        title: calendarTitle,
                        existingCalendar: true
                    });
                } else {
                    logWarning(`Calendar ID in competitions.json not found in Google. Creating new calendar...`);
                    // Calendar was deleted from Google, need to create a new one
                    const calendarData = await createCalendar(
                        calendar, 
                        calendarTitle,
                        `${await getClubName()} - ${competition.name} fixtures and events`
                    );
                    
                    calendarUpdates.push({
                        competitionName: competition.name,
                        calendarId: calendarData.calendarId,
                        publicUrl: calendarData.publicUrl,
                        icalUrl: calendarData.icalUrl,
                        title: calendarData.title,
                        existingCalendar: false
                    });
                    
                    logSuccess(`Created replacement calendar: ${calendarTitle}`);
                }
            } else {
                // No calendar details in competitions.json, check if one exists in Google
                const existingCalendar = existingCalendars.find(cal => 
                    cal.summary === calendarTitle
                );
                
                if (existingCalendar) {
                    logWarning(`Calendar exists in Google but not in competitions.json: ${calendarTitle}`);
                    
                    const publicUrl = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(existingCalendar.id)}`;
                    const icalUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(existingCalendar.id)}/public/basic.ics`;
                    
                    calendarUpdates.push({
                        competitionName: competition.name,
                        calendarId: existingCalendar.id,
                        publicUrl: publicUrl,
                        icalUrl: icalUrl,
                        title: calendarTitle,
                        existingCalendar: true
                    });
                } else {
                    logInfo(`Creating new calendar: ${calendarTitle}`);
                    
                    const calendarData = await createCalendar(
                        calendar, 
                        calendarTitle,
                        `${await getClubName()} - ${competition.name} fixtures and events`
                    );
                    
                    calendarUpdates.push({
                        competitionName: competition.name,
                        calendarId: calendarData.calendarId,
                        publicUrl: calendarData.publicUrl,
                        icalUrl: calendarData.icalUrl,
                        title: calendarData.title,
                        existingCalendar: false
                    });
                    
                    logSuccess(`Created: ${calendarTitle}`);
                }
            }
            
            // Add delay between API calls
            if (i < competitionsToProcess.length - 1) {
                logInfo('Waiting 2 seconds before next API call...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
        } catch (error) {
            logWarning(`Failed to process ${competition.name}: ${error.message}`);
            // Continue with other competitions
        }
    }
    
    // Update competition data
    if (calendarUpdates.length > 0) {
        logInfo('Updating competition data file...');
        await updateCompetitionData(competitionData, calendarUpdates);
        
        const newlyCreated = calendarUpdates.filter(cal => !cal.existingCalendar).length;
        const reused = calendarUpdates.filter(cal => cal.existingCalendar).length;
        
        console.log(`\\n🎉 Process complete!`);
        console.log(`📊 Summary:`);
        console.log(`   ✅ Newly created calendars: ${newlyCreated}`);
        console.log(`   🔄 Existing calendars updated: ${reused}`);
        console.log(`   📄 Total calendars processed: ${calendarUpdates.length}`);
        logSuccess(`Updated data saved to ${COMPETITIONS_FILE}`);
        
        // Display calendar details
        if (newlyCreated > 0) {
            console.log('\\n📋 Newly Created Calendars:');
            calendarUpdates
                .filter(cal => !cal.existingCalendar)
                .forEach((cal, index) => {
                    console.log(`${index + 1}. ${cal.title}`);
                    console.log(`   📅 Calendar ID: ${cal.calendarId}`);
                    console.log(`   🌐 Public URL: ${cal.publicUrl}\\n`);
                });
        }
    } else {
        logWarning('No calendars were created or updated');
    }
}

/**
 * Show help information
 */
function showHelp() {
    console.log(`
📅 Google Calendar Creator

Creates Google Calendars for each competition found in competitions.json

Usage:
  npm run create-calendars [-- options]

Options:
  --help, -h       Show this help message

Examples:
  npm run create-calendars                    # Create calendars for all competitions
  npm run create-calendars -- --help         # Show this help

Process:
  1. Loads competitions from ${COMPETITIONS_FILE}
  2. Connects to Google Calendar API using service-account-key.json
  3. Creates public calendars with club prefix
  4. Updates competitions.json with calendar IDs and public URLs
  5. Skips competitions that already have calendars configured

Requirements:
  • service-account-key.json must exist in project root
  • Google Calendar API must be enabled
  • Service account must have calendar creation permissions
`);
}

/**
 * Parse command line arguments
 */
function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        help: false
    };
    
    for (const arg of args) {
        if (arg === '--help' || arg === '-h') {
            options.help = true;
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
    
    await withErrorHandling(createGoogleCalendars, 'create-calendars')();
}

// Run if called directly
if (process.argv[1] === __filename) {
    main();
}

export { createGoogleCalendars };