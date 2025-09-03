import { google } from 'googleapis';
import { SCOPES, SERVICE_ACCOUNT_KEY } from './config.js';

/**
 * Initialize Google Calendar API client with authentication
 * @returns {Promise<Object>} - Authenticated Google Calendar API client
 */
export async function initializeCalendarClient() {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: SERVICE_ACCOUNT_KEY,
            scopes: SCOPES,
        });

        const authClient = await auth.getClient();
        const calendar = google.calendar({ version: 'v3', auth: authClient });
        
        return calendar;
    } catch (error) {
        throw new Error(`Google Calendar authentication failed: ${error.message}`);
    }
}

/**
 * Initialize Google Calendar API client (alternative name for compatibility)
 * @returns {Promise<Object>} - Authenticated Google Calendar API client
 */
export const authenticateGoogle = initializeCalendarClient;

/**
 * Test authentication by attempting to list calendars
 * @returns {Promise<boolean>} - True if authentication successful
 */
export async function testAuthentication() {
    try {
        const calendar = await initializeCalendarClient();
        await calendar.calendarList.list({ maxResults: 1 });
        return true;
    } catch (error) {
        console.error('Authentication test failed:', error.message);
        return false;
    }
}