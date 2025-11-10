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
 * Parse raw iCal data to extract original datetime strings
 * This bypasses the ical library's timezone conversion
 */
function parseRawICalDateTimes(icalData) {
    const events = {};
    const eventBlocks = icalData.split('BEGIN:VEVENT');

    for (let i = 1; i < eventBlocks.length; i++) {
        const eventText = eventBlocks[i].split('END:VEVENT')[0];
        const lines = eventText.split(/\r?\n/);

        let uid = null;
        let dtstart = null;
        let dtend = null;

        for (const line of lines) {
            if (line.startsWith('UID:')) {
                uid = line.substring(4).trim();
            } else if (line.startsWith('DTSTART')) {
                // Extract the datetime value after the colon
                // Format: DTSTART;TZID=Australia/Melbourne:20251005T091000
                const colonIndex = line.indexOf(':');
                if (colonIndex !== -1) {
                    dtstart = line.substring(colonIndex + 1).trim();
                }
            } else if (line.startsWith('DTEND')) {
                // Extract the datetime value after the colon
                const colonIndex = line.indexOf(':');
                if (colonIndex !== -1) {
                    dtend = line.substring(colonIndex + 1).trim();
                }
            }
        }

        if (uid && dtstart && dtend) {
            events[uid] = { dtstart, dtend };
        }
    }

    return events;
}

/**
 * Convert iCal datetime format to RFC3339 format
 * Input: 20251005T091000
 * Output: 2025-10-05T09:10:00
 */
function convertICalDateTimeToRFC3339(icalDateTime) {
    // Format: YYYYMMDDTHHMMSS
    const year = icalDateTime.substring(0, 4);
    const month = icalDateTime.substring(4, 6);
    const day = icalDateTime.substring(6, 8);
    const hour = icalDateTime.substring(9, 11);
    const minute = icalDateTime.substring(11, 13);
    const second = icalDateTime.substring(13, 15);

    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

/**
 * Import events from iCal file to Google Calendar
 */
export async function importICalToGoogle(calendar, calendarId, icalPath) {
    logInfo(`Importing events from: ${icalPath}`);

    try {
        const icalData = await fs.readFile(icalPath, 'utf8');
        const parsedCal = ical.parseICS(icalData);

        // Parse raw datetime values to avoid timezone conversion issues
        const rawDateTimes = parseRawICalDateTimes(icalData);

        let imported = 0;
        let failed = 0;

        for (const key in parsedCal) {
            const event = parsedCal[key];
            if (event.type === 'VEVENT') {
                try {
                    // Validate event has required fields
                    if (!event.uid) {
                        logWarning(`Event missing UID: ${event.summary || 'Unknown'}`);
                        failed++;
                        continue;
                    }

                    // Get raw datetime values
                    const rawEvent = rawDateTimes[event.uid];
                    if (!rawEvent || !rawEvent.dtstart || !rawEvent.dtend) {
                        logWarning(`Event missing raw datetime values: ${event.summary || 'Unknown'}`);
                        failed++;
                        continue;
                    }

                    // Convert iCal datetime format to RFC3339 format
                    const startDateTime = convertICalDateTimeToRFC3339(rawEvent.dtstart);
                    const endDateTime = convertICalDateTimeToRFC3339(rawEvent.dtend);

                    // Debug logging
                    if (process.env.GITHUB_ACTIONS) {
                        console.log(`DEBUG: Importing "${event.summary}" - Start: ${startDateTime}, End: ${endDateTime} (Melbourne time)`);
                    }

                    const googleEvent = {
                        summary: event.summary || 'No title',
                        description: event.description || '',
                        start: {
                            dateTime: startDateTime,
                            timeZone: 'Australia/Melbourne'
                        },
                        end: {
                            dateTime: endDateTime,
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

        // Warn if no events were imported
        if (imported === 0 && failed === 0) {
            logWarning(`No events found in calendar file. The calendar may be empty or all events were filtered out.`);
        } else if (imported === 0 && failed > 0) {
            logWarning(`Failed to import all ${failed} events. Check the errors above for details.`);
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