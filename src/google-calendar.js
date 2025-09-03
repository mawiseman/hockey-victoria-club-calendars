import { google } from 'googleapis';
import fs from 'fs/promises';
import ical from 'ical';

/**
 * Authenticate with Google Calendar API using service account
 */
export async function authenticateGoogle() {
    try {
        // Use service account credentials from environment variable
        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
        
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/calendar']
        });
        
        const authClient = await auth.getClient();
        const calendar = google.calendar({ version: 'v3', auth: authClient });
        
        return calendar;
    } catch (error) {
        console.error('Authentication error:', error);
        throw error;
    }
}

/**
 * Delete all events from a Google Calendar
 */
export async function deleteAllEvents(calendar, calendarId) {
    console.log(`Deleting old events from calendar: ${calendarId}`);
    
    try {
        // List all events
        const response = await calendar.events.list({
            calendarId,
            maxResults: 2500,
            singleEvents: true,
            showDeleted: false
        });
        
        const events = response.data.items || [];
        
        if (events.length === 0) {
            console.log('No events to delete');
            return;
        }
        
        // Delete each event
        for (const event of events) {
            try {
                await calendar.events.delete({
                    calendarId,
                    eventId: event.id
                });
            } catch (deleteError) {
                console.warn(`Failed to delete event ${event.id}: ${deleteError.message}`);
            }
        }
        
        console.log(`Deleted ${events.length} events`);
    } catch (error) {
        console.error(`Error deleting events: ${error.message}`);
        throw error;
    }
}

/**
 * Import events from iCal file to Google Calendar
 */
export async function importICalToGoogle(calendar, calendarId, icalPath) {
    console.log(`Importing events to calendar: ${calendarId}`);
    
    try {
        const icalData = await fs.readFile(icalPath, 'utf8');
        const parsedCal = ical.parseICS(icalData);
        
        let imported = 0;
        let failed = 0;
        
        for (const key in parsedCal) {
            const event = parsedCal[key];
            if (event.type === 'VEVENT') {
                try {
                    const googleEvent = {
                        summary: event.summary,
                        description: event.description,
                        location: event.location,
                        start: {
                            dateTime: event.start.toISOString(),
                            timeZone: 'Australia/Melbourne'
                        },
                        end: {
                            dateTime: event.end.toISOString(),
                            timeZone: 'Australia/Melbourne'
                        }
                    };
                    
                    await calendar.events.insert({
                        calendarId,
                        resource: googleEvent
                    });
                    
                    imported++;
                } catch (insertError) {
                    console.warn(`Failed to import event: ${insertError.message}`);
                    failed++;
                }
            }
        }
        
        console.log(`Imported ${imported} events (${failed} failed)`);
        return { imported, failed };
    } catch (error) {
        console.error(`Error importing events: ${error.message}`);
        throw error;
    }
}

/**
 * Upload processed calendar to multiple Google Calendars
 */
export async function uploadToGoogleCalendars(processedPath, calendarIds) {
    const calendar = await authenticateGoogle();
    const results = [];
    
    for (const calendarId of calendarIds) {
        console.log(`\nUploading to calendar: ${calendarId}`);
        
        try {
            // Delete old events
            await deleteAllEvents(calendar, calendarId);
            
            // Import new events
            const importResult = await importICalToGoogle(calendar, calendarId, processedPath);
            
            results.push({
                calendarId,
                success: true,
                ...importResult
            });
        } catch (error) {
            console.error(`Failed to upload to ${calendarId}: ${error.message}`);
            results.push({
                calendarId,
                success: false,
                error: error.message
            });
        }
    }
    
    return results;
}

/**
 * Process and upload all calendars
 */
export async function uploadAllCalendars(processResults) {
    const uploadResults = {};
    
    for (const [name, result] of Object.entries(processResults)) {
        if (result.success && result.processedPath && result.competition.calendars) {
            console.log(`\n===== Uploading: ${name} =====`);
            
            try {
                const uploadResult = await uploadToGoogleCalendars(
                    result.processedPath,
                    result.competition.calendars
                );
                
                uploadResults[name] = {
                    success: true,
                    calendars: uploadResult
                };
            } catch (error) {
                console.error(`Upload failed for ${name}: ${error.message}`);
                uploadResults[name] = {
                    success: false,
                    error: error.message
                };
            }
        } else {
            uploadResults[name] = {
                success: false,
                error: 'Processing failed or no calendars specified'
            };
        }
    }
    
    return uploadResults;
}