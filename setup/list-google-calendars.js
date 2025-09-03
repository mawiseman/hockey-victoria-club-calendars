import { google } from 'googleapis';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
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
 * List all calendars accessible by the service account
 */
async function listCalendars() {
    console.log('🔍 Fetching calendars owned by service account...\n');
    
    try {
        // Initialize Google Calendar API
        const calendar = await initializeCalendarClient();
        
        // Get list of calendars
        const response = await calendar.calendarList.list({
            maxResults: 250,
            showDeleted: false,
            showHidden: false
        });
        
        const calendars = response.data.items || [];
        
        if (calendars.length === 0) {
            console.log('📭 No calendars found for this service account.');
            return;
        }
        
        console.log(`📅 Found ${calendars.length} calendar(s):\n`);
        
        // Group calendars by type
        const competitionCalendars = [];
        const otherCalendars = [];
        
        calendars.forEach(cal => {
            if (cal.summary && cal.summary.startsWith(CALENDAR_PREFIX)) {
                competitionCalendars.push(cal);
            } else {
                otherCalendars.push(cal);
            }
        });
        
        // Display Competition calendars first
        if (competitionCalendars.length > 0) {
            console.log('🏒 Calendars:');
            console.log('━'.repeat(80));
            
            competitionCalendars.forEach((cal, index) => {
                console.log(`\n${index + 1}. ${cal.summary}`);
                console.log(`   📋 Calendar ID: ${cal.id}`);
                console.log(`   📝 Description: ${cal.description || 'No description'}`);
                console.log(`   🎨 Color: ${cal.backgroundColor || 'Default'}`);
                console.log(`   🌍 Time Zone: ${cal.timeZone || 'Not set'}`);
                console.log(`   🔒 Access Role: ${cal.accessRole}`);
                
                // Generate public URL
                const publicUrl = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(cal.id)}`;
                console.log(`   🌐 Public URL: ${publicUrl}`);
                
                // Generate iCal URL
                const icalUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(cal.id)}/public/basic.ics`;
                console.log(`   📥 iCal URL: ${icalUrl}`);
            });
        }
        
        // Display other calendars
        if (otherCalendars.length > 0) {
            console.log('\n\n📚 Other Calendars:');
            console.log('━'.repeat(80));
            
            otherCalendars.forEach((cal, index) => {
                console.log(`\n${index + 1}. ${cal.summary || cal.id}`);
                console.log(`   📋 Calendar ID: ${cal.id}`);
                console.log(`   🔒 Access Role: ${cal.accessRole}`);
                
                if (cal.primary) {
                    console.log(`   ⭐ Primary calendar`);
                }
            });
        }
        
        // Display summary statistics
        console.log('\n\n📊 Summary:');
        console.log('━'.repeat(80));
        console.log(`Total calendars: ${calendars.length}`);
        console.log(`Competition calendars: ${competitionCalendars.length}`);
        console.log(`Other calendars: ${otherCalendars.length}`);
        
        // Display access role breakdown
        const roleCount = {};
        calendars.forEach(cal => {
            roleCount[cal.accessRole] = (roleCount[cal.accessRole] || 0) + 1;
        });
        
        console.log('\n🔐 Access Roles:');
        Object.entries(roleCount).forEach(([role, count]) => {
            console.log(`   ${role}: ${count}`);
        });
        
    } catch (error) {
        console.error(`❌ Error listing calendars: ${error.message}`);
        
        if (error.message.includes('service-account-key.json')) {
            console.log('\n💡 Setup required:');
            console.log('1. Ensure service-account-key.json exists in the project root');
            console.log('2. Check that the service account has Calendar API permissions');
        }
        
        process.exit(1);
    }
}

/**
 * Export calendar list as JSON
 */
async function exportCalendarList() {
    try {
        const calendar = await initializeCalendarClient();
        const response = await calendar.calendarList.list({
            maxResults: 250,
            showDeleted: false,
            showHidden: false
        });
        
        const calendars = response.data.items || [];
        
        const exportData = {
            exportedAt: new Date().toISOString(),
            totalCalendars: calendars.length,
            calendars: calendars.map(cal => ({
                id: cal.id,
                summary: cal.summary,
                description: cal.description,
                timeZone: cal.timeZone,
                accessRole: cal.accessRole,
                backgroundColor: cal.backgroundColor,
                primary: cal.primary,
                publicUrl: `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(cal.id)}`,
                icalUrl: `https://calendar.google.com/calendar/ical/${encodeURIComponent(cal.id)}/public/basic.ics`
            }))
        };
        
        const fs = await import('fs/promises');
        await fs.mkdir('temp', { recursive: true });
        await fs.writeFile(
            'temp/google-calendars-list.json', 
            JSON.stringify(exportData, null, 2),
            'utf8'
        );
        
        console.log('✅ Calendar list exported to temp/google-calendars-list.json');
        
    } catch (error) {
        console.error(`❌ Error exporting calendars: ${error.message}`);
    }
}

/**
 * Main execution
 */
async function main() {
    // Check for export flag
    const args = process.argv.slice(2);
    const shouldExport = args.includes('--export') || args.includes('-e');
    
    await listCalendars();
    
    if (shouldExport) {
        console.log('\n📁 Exporting calendar list...');
        await exportCalendarList();
    }
}

// Run the script if called directly
if (process.argv[1] === __filename) {
    main();
}

export { listCalendars, exportCalendarList };