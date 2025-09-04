import fs from 'fs/promises';
import ical from 'ical';

// Import shared utilities
import { authenticateGoogle } from '../lib/google-auth.js';
import { getDetailedError, isApiLimitError, logSuccess, logWarning, logInfo } from '../lib/error-utils.js';

/**
 * Delete all events from a Google Calendar
 */
export async function deleteAllEvents(calendar, calendarId) {
    logInfo(`Deleting old events from calendar: ${calendarId}`);
    
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
            logInfo('No events to delete');
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
                logWarning(`Failed to delete event ${event.id}: ${getDetailedError(deleteError)}`);
            }
        }
        
        logSuccess(`Deleted ${events.length} events`);
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
    logInfo(`Importing events from: ${icalPath}`);
    
    try {
        const icalData = await fs.readFile(icalPath, 'utf8');
        const parsedCal = ical.parseICS(icalData);
        
        let imported = 0;
        let failed = 0;
        
        for (const key in parsedCal) {
            const event = parsedCal[key];
            if (event.type === 'VEVENT') {
                try {
                    // Validate event times
                    if (!event.start || !event.end) {
                        logWarning(`Event missing start or end time: ${event.summary || 'Unknown'}`);
                        failed++;
                        continue;
                    }
                    
                    // Parse the times from the processed iCal
                    let startTime, endTime;
                    
                    if (event.start instanceof Date) {
                        startTime = event.start;
                    } else {
                        startTime = new Date(event.start);
                    }
                    
                    if (event.end instanceof Date) {
                        endTime = event.end;
                    } else {
                        endTime = new Date(event.end);
                    }
                    
                    // Check for invalid dates
                    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
                        logWarning(`Event has invalid date/time: ${event.summary || 'Unknown'} - Start: ${event.start}, End: ${event.end}`);
                        failed++;
                        continue;
                    }
                    
                    // Check for empty time range (end time must be after start time)
                    if (endTime <= startTime) {
                        logWarning(`Event has invalid time range (end <= start): ${event.summary || 'Unknown'} - Start: ${startTime.toISOString()}, End: ${endTime.toISOString()}`);
                        failed++;
                        continue;
                    }
                    
                    // Debug logging for GitHub Actions
                    if (process.env.GITHUB_ACTIONS) {
                        console.log(`DEBUG: Importing "${event.summary}" - Start: ${startTime.toISOString()}, End: ${endTime.toISOString()}`);
                    }
                    
                    const googleEvent = {
                        summary: event.summary || 'No title',
                        description: event.description || '',
                        start: {
                            dateTime: startTime.toISOString(),
                            timeZone: 'Australia/Melbourne'
                        },
                        end: {
                            dateTime: endTime.toISOString(),
                            timeZone: 'Australia/Melbourne'
                        },
                        location: event.location || ''
                    };
                    
                    await calendar.events.insert({
                        calendarId,
                        resource: googleEvent
                    });
                    
                    imported++;
                } catch (insertError) {
                    logWarning(`Failed to import event: ${getDetailedError(insertError)}`);
                    failed++;
                }
            }
        }
        
        logSuccess(`Imported ${imported} events (${failed} failed)`);
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
        logInfo(`Uploading to calendar: ${calendarId}`);
        
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
            logInfo(`Uploading: ${name}`);
            
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