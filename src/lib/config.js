/**
 * Shared configuration constants for setup scripts
 */
import fs from 'fs/promises';

// Load settings from ../config/settings.json
let settings = null;

async function loadSettings() {
    if (!settings) {
        const data = await fs.readFile('config/settings.json', 'utf8');
        settings = JSON.parse(data);
    }
    return settings;
}

// Settings that need to be loaded dynamically
export async function getSettings() {
    return await loadSettings();
}

export async function getCalendarPrefix() {
    const settings = await loadSettings();
    return settings.calendarPrefix;
}

export async function getClubName() {
    const settings = await loadSettings();
    return settings.clubName;
}

// File paths
export const COMPETITIONS_FILE = 'config/competitions.json';
export const SERVICE_ACCOUNT_KEY = 'service-account-key.json';
export const OUTPUT_DIR = 'docs';
export const TEMP_DIR = 'temp';
export const PROGRESS_FILE = 'temp/scraper-progress.json';
export const MAPPINGS_CLUB_FILE = 'config/mappings-club-names.json';
export const MAPPINGS_COMPETITION_FILE = 'config/mappings-competition-names.json';
export const MAPPINGS_DURATION_FILE = 'config/mappings-competition-durations.json';

// Google Calendar configuration
export const SCOPES = ['https://www.googleapis.com/auth/calendar'];

// Hockey Victoria configuration
export const BASE_URL = 'https://www.hockeyvictoria.org.au/games/';

// API limits and performance
export const MAX_CONCURRENT = 5;
export const API_DELAY = 100; // milliseconds between requests

// Competition categorization patterns
export const COMPETITION_CATEGORIES = {
    MIDWEEK: ['midweek', '35+', 't1', 't2', 't3', 't4', 'masters', 'wednesday', 'tuesday', 'monday', 'thursday', 'friday'],
    JUNIORS: ['u12', 'u14', 'u16', 'u18', 'under 12', 'under 14', 'under 16', 'under 18', 'mixed', 'girls'],
    WOMENS: ["women's", 'women ', 'womens'],
    MENS: ["men's", 'men ', 'mens']
};

// Default timeouts
export const DEFAULT_TIMEOUT = 30000; // 30 seconds
export const PAGE_WAIT_TIME = 2000; // 2 seconds

/**
 * Get current year as string
 * @returns {string} Current year
 */
export function getCurrentYear() {
    return new Date().getFullYear().toString();
}

/**
 * Get current timestamp in ISO format
 * @returns {string} ISO timestamp
 */
export function getCurrentTimestamp() {
    return new Date().toISOString();
}

/**
 * Load competition duration mappings
 * @returns {Promise<Object>} Duration configuration
 */
export async function getDurationConfig() {
    const data = await fs.readFile(MAPPINGS_DURATION_FILE, 'utf8');
    return JSON.parse(data);
}