import { google } from 'googleapis';
import fs from 'fs/promises';
import ical from 'ical';

/**
 * Check if error is due to API limits
 */
function isApiLimitError(error) {
    if (!error.response) return false;
    
    const status = error.response.status;
    const data = error.response.data;
    
    // Check for various API limit scenarios
    if (status === 429) return true; // Too Many Requests
    if (status === 403 && data?.error?.errors) {
        const errors = data.error.errors;
        return errors.some(err => 
            err.reason === 'rateLimitExceeded' ||
            err.reason === 'userRateLimitExceeded' ||
            err.reason === 'quotaExceeded' ||
            err.reason === 'dailyLimitExceeded'
        );
    }
    
    return false;
}

/**
 * Get detailed error message
 */
function getDetailedError(error) {
    if (isApiLimitError(error)) {
        return `🚫 Google Calendar API limit exceeded: ${error.message}. Please wait and try again later.`;
    }
    
    if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        
        if (status === 404) {
            return `❌ Calendar not found: ${error.message}`;
        }
        if (status === 401) {
            return `🔐 Authentication failed: ${error.message}`;
        }
        if (status === 403) {
            return `⛔ Permission denied: ${error.message}`;
        }
        
        return `📡 API error (${status}): ${data?.error?.message || error.message}`;
    }
    
    return `💥 Unexpected error: ${error.message}`;
}

/**
 * Authenticate with Google Calendar API using service account
 */
export async function authenticateGoogle() {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: 'service-account-key.json',
            scopes: ['https://www.googleapis.com/auth/calendar']
        });

        const authClient = await auth.getClient();
        const calendar = google.calendar({ version: 'v3', auth: authClient });
        
        return calendar;
    } catch (error) {
        console.error('Authentication error:', getDetailedError(error));
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
                console.warn(`Failed to delete event ${event.id}: ${getDetailedError(deleteError)}`);
            }
        }
        
        console.log(`Deleted ${events.length} events`);
    } catch (error) {
        const detailedError = getDetailedError(error);
        console.error(`Error deleting events: ${detailedError}`);
        throw new Error(detailedError);
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
                    console.warn(`Failed to import event: ${getDetailedError(insertError)}`);
                    failed++;
                }
            }
        }
        
        console.log(`Imported ${imported} events (${failed} failed)`);
        return { imported, failed };
    } catch (error) {
        const detailedError = getDetailedError(error);
        console.error(`Error importing events: ${detailedError}`);
        throw new Error(detailedError);
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
            const detailedError = getDetailedError(error);
            console.error(`Failed to upload to ${calendarId}: ${detailedError}`);
            results.push({
                calendarId,
                success: false,
                error: detailedError
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
        // Extract calendar IDs from the competition data
        let calendarIds = null;
        
        if (result.competition.calendars) {
            // Legacy format: array of calendar IDs
            calendarIds = result.competition.calendars;
        } else if (result.competition.googleCalendar && result.competition.googleCalendar.calendarId) {
            // New format: single googleCalendar object
            calendarIds = [result.competition.googleCalendar.calendarId];
        }
        
        if (result.success && result.processedPath && calendarIds) {
            console.log(`\n===== Uploading: ${name} =====`);
            
            try {
                const uploadResult = await uploadToGoogleCalendars(
                    result.processedPath,
                    calendarIds
                );
                
                uploadResults[name] = {
                    success: true,
                    calendars: uploadResult
                };
            } catch (error) {
                const detailedError = getDetailedError(error);
                console.error(`Upload failed for ${name}: ${detailedError}`);
                uploadResults[name] = {
                    success: false,
                    error: detailedError
                };
            }
        } else {
            // Provide more detailed error information
            let errorMsg = 'Upload failed: ';
            if (!result.success) {
                errorMsg += 'processing step failed';
            } else if (!result.processedPath) {
                errorMsg += 'no processed calendar file found';
            } else if (!calendarIds) {
                errorMsg += 'no Google Calendar IDs specified for this competition';
            } else {
                errorMsg += 'unknown error';
            }
            
            console.error(`${name}: ${errorMsg}`);
            uploadResults[name] = {
                success: false,
                error: errorMsg
            };
        }
    }
    
    return uploadResults;
}