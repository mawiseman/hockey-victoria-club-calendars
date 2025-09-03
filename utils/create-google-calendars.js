import fs from 'fs/promises';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMPETITIONS_FILE = 'scraper-output/footscray-competitions.json';
const CALENDAR_PREFIX = 'FHC ';
const CLUB_NAME = 'Footscray Hockey Club';
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

/**
 * Load competition data from scraper output
 */
async function loadCompetitionData() {
    try {
        const data = await fs.readFile(COMPETITIONS_FILE, 'utf8');
        const competitions = JSON.parse(data);
        
        if (!competitions.competitions || !Array.isArray(competitions.competitions)) {
            throw new Error('Invalid competition data format');
        }
        
        return competitions;
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`Competition file not found: ${COMPETITIONS_FILE}. Run the scraper first.`);
        }
        throw error;
    }
}

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
        console.error('Error fetching existing calendars:', error.message);
        return [];
    }
}

/**
 * Create a public Google Calendar
 */
async function createPublicCalendar(calendar, competitionName) {
    const calendarTitle = `${CALENDAR_PREFIX}${competitionName}`;
    
    console.log(`📅 Creating calendar: ${calendarTitle}`);
    
    try {
        // Create the calendar
        const calendarResource = {
            summary: calendarTitle,
            description: `${CLUB_NAME} fixtures for ${competitionName}`,
            timeZone: 'Australia/Melbourne',
        };
        
        const createdCalendar = await calendar.calendars.insert({
            resource: calendarResource
        });
        
        const calendarId = createdCalendar.data.id;
        console.log(`✅ Created calendar with ID: ${calendarId}`);
        
        // Make the calendar public
        await calendar.acl.insert({
            calendarId: calendarId,
            resource: {
                role: 'reader',
                scope: {
                    type: 'default'  // Makes it public
                }
            }
        });
        
        console.log(`🌐 Made calendar public`);
        
        // Generate public URL
        const publicUrl = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(calendarId)}`;
        
        return {
            calendarId: calendarId,
            publicUrl: publicUrl,
            title: calendarTitle
        };
        
    } catch (error) {
        console.error(`❌ Failed to create calendar for ${competitionName}: ${error.message}`);
        throw error;
    }
}

/**
 * Update competition data with Google Calendar information
 */
async function updateCompetitionData(competitionData, calendarUpdates) {
    console.log(`📝 Updating competition data with calendar information...`);
    
    // Update each competition with its calendar data
    competitionData.competitions.forEach(competition => {
        const calendarInfo = calendarUpdates.find(cal => 
            cal.originalName === competition.name
        );
        
        if (calendarInfo) {
            competition.googleCalendar = {
                calendarId: calendarInfo.calendarId,
                publicUrl: calendarInfo.publicUrl,
                title: calendarInfo.title,
                createdAt: new Date().toISOString()
            };
        }
    });
    
    // Update metadata
    competitionData.lastUpdated = new Date().toISOString();
    competitionData.hasGoogleCalendars = true;
    competitionData.calendarsCreated = calendarUpdates.length;
    
    // Save updated data
    await fs.writeFile(COMPETITIONS_FILE, JSON.stringify(competitionData, null, 2), 'utf8');
    console.log(`✅ Updated ${COMPETITIONS_FILE} with calendar information`);
}

/**
 * Create Google Calendars for all competitions
 */
async function createCalendarsForCompetitions() {
    console.log('🚀 Starting Google Calendar creation process...\n');
    
    try {
        // Load competition data
        console.log('📂 Loading competition data...');
        const competitionData = await loadCompetitionData();
        console.log(`📊 Found ${competitionData.competitions.length} competitions`);
        
        // Check if calendars already exist
        const existingCalendars = competitionData.competitions.filter(comp => comp.googleCalendar);
        if (existingCalendars.length > 0) {
            console.log(`⚠️  ${existingCalendars.length} competitions already have calendars in JSON`);
        }
        
        const newCompetitions = competitionData.competitions.filter(comp => !comp.googleCalendar);
        
        if (newCompetitions.length === 0) {
            console.log('✅ All competitions already have Google Calendars!');
            return;
        }
        
        console.log(`📅 Need to process ${newCompetitions.length} competitions...\n`);
        
        // Initialize Google Calendar API
        console.log('🔐 Initializing Google Calendar API...');
        const calendar = await initializeCalendarClient();
        console.log('✅ Google Calendar API initialized\n');
        
        // Get existing calendars from Google to check for duplicates
        console.log('🔍 Checking for existing calendars in Google...');
        const googleCalendars = await getExistingCalendars(calendar);
        const existingCalendarNames = new Set(
            googleCalendars.map(cal => cal.summary).filter(Boolean)
        );
        console.log(`📋 Found ${googleCalendars.length} existing calendars in Google\n`);
        
        const calendarUpdates = [];
        const skippedCompetitions = [];
        
        // Create calendars for each competition
        for (let i = 0; i < newCompetitions.length; i++) {
            const competition = newCompetitions[i];
            const proposedCalendarName = `${CALENDAR_PREFIX}${competition.name}`;
            
            console.log(`\n[${i + 1}/${newCompetitions.length}] Processing: ${competition.name}`);
            
            // Check if a calendar with this name already exists
            if (existingCalendarNames.has(proposedCalendarName)) {
                console.log(`⚠️  Calendar already exists with name: ${proposedCalendarName}`);
                
                // Find the existing calendar to get its details
                const existingCal = googleCalendars.find(cal => cal.summary === proposedCalendarName);
                if (existingCal) {
                    console.log(`   📋 Existing Calendar ID: ${existingCal.id}`);
                    const publicUrl = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(existingCal.id)}`;
                    console.log(`   🌐 Public URL: ${publicUrl}`);
                    
                    // Add to updates so it gets saved in the JSON
                    calendarUpdates.push({
                        originalName: competition.name,
                        calendarId: existingCal.id,
                        publicUrl: publicUrl,
                        title: existingCal.summary,
                        existingCalendar: true  // Mark as already existing
                    });
                    
                    skippedCompetitions.push(competition.name);
                }
                continue;
            }
            
            try {
                const calendarInfo = await createPublicCalendar(calendar, competition.name);
                
                calendarUpdates.push({
                    originalName: competition.name,
                    ...calendarInfo
                });
                
                console.log(`📋 Public URL: ${calendarInfo.publicUrl}`);
                
                // Add delay between API calls to respect rate limits
                if (i < newCompetitions.length - 1) {
                    console.log('⏳ Waiting 2 seconds...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                
            } catch (error) {
                console.error(`❌ Failed to create calendar for ${competition.name}: ${error.message}`);
                // Continue with other competitions
            }
        }
        
        // Update the competition data file
        if (calendarUpdates.length > 0) {
            await updateCompetitionData(competitionData, calendarUpdates);
            
            const newlyCreated = calendarUpdates.filter(cal => !cal.existingCalendar).length;
            const reused = calendarUpdates.filter(cal => cal.existingCalendar).length;
            
            console.log(`\n🎉 Process complete!`);
            console.log(`📊 Summary:`);
            console.log(`   ✅ Newly created calendars: ${newlyCreated}`);
            console.log(`   🔄 Existing calendars reused: ${reused}`);
            console.log(`   📄 Total calendars processed: ${calendarUpdates.length}`);
            console.log(`   💾 Updated data saved to ${COMPETITIONS_FILE}`);
            
            // Display details for newly created calendars
            if (newlyCreated > 0) {
                console.log('\n📋 Newly Created Calendars:');
                calendarUpdates
                    .filter(cal => !cal.existingCalendar)
                    .forEach((cal, index) => {
                        console.log(`${index + 1}. ${cal.title}`);
                        console.log(`   📅 Calendar ID: ${cal.calendarId}`);
                        console.log(`   🌐 Public URL: ${cal.publicUrl}\n`);
                    });
            }
            
            // Display details for reused calendars
            if (reused > 0) {
                console.log('\n♻️  Existing Calendars Linked:');
                calendarUpdates
                    .filter(cal => cal.existingCalendar)
                    .forEach((cal, index) => {
                        console.log(`${index + 1}. ${cal.title}`);
                        console.log(`   📅 Calendar ID: ${cal.calendarId}`);
                        console.log(`   🌐 Public URL: ${cal.publicUrl}\n`);
                    });
            }
        } else {
            console.log('\n⚠️  No calendars were successfully created or linked.');
        }
        
    } catch (error) {
        console.error(`💥 Script failed: ${error.message}`);
        
        if (error.message.includes('service-account-key.json')) {
            console.log('\n💡 Setup instructions:');
            console.log('1. Create a Google Cloud Project');
            console.log('2. Enable the Google Calendar API');
            console.log('3. Create a Service Account');
            console.log('4. Download the service account key as service-account-key.json');
            console.log('5. Place it in the project root directory');
        }
        
        process.exit(1);
    }
}

/**
 * Main execution
 */
async function main() {
    await createCalendarsForCompetitions();
}

// Run the script if called directly
if (process.argv[1] === __filename) {
    main();
}

export { createCalendarsForCompetitions, createPublicCalendar, loadCompetitionData };