import fs from 'fs/promises';
import { COMPETITIONS_FILE, COMPETITION_CATEGORIES } from './config.js';

/**
 * Load competition data from JSON file
 * @param {string} filePath - Optional custom file path
 * @returns {Promise<Object>} - Competition data object
 */
export async function loadCompetitionData(filePath = COMPETITIONS_FILE) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        const competitionsData = JSON.parse(data);
        
        if (!competitionsData.competitions || !Array.isArray(competitionsData.competitions)) {
            throw new Error('Invalid competition data format - missing competitions array');
        }
        
        return competitionsData;
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`Competition file not found: ${filePath}. Run the competition scraper first.`);
        }
        throw error;
    }
}

/**
 * Get just the competitions array from the data file
 * @param {string} filePath - Optional custom file path
 * @returns {Promise<Array>} - Array of competition objects
 */
export async function loadCompetitions(filePath = COMPETITIONS_FILE) {
    const data = await loadCompetitionData(filePath);
    return data.competitions;
}

/**
 * Custom sorting function for Men's and Women's competitions
 * @param {Array} competitions - Array of competition objects
 * @returns {Array} - Sorted competitions
 */
function sortSeniorCompetitions(competitions) {
    return competitions.sort((a, b) => {
        const nameA = a.name.toLowerCase();
        const nameB = b.name.toLowerCase();
        
        // Extract competition type and level for comparison
        const getCompetitionOrder = (name) => {
            if (name.includes('premier league reserves') || name.includes('premier league reserve')) {
                return { type: 'premier', level: 2, name };
            } else if (name.includes('premier league')) {
                return { type: 'premier', level: 1, name };
            } else if (name.includes('pennant a')) {
                return { type: 'pennant', level: 1, name };
            } else if (name.includes('pennant b')) {
                return { type: 'pennant', level: 2, name };
            } else if (name.includes('pennant c')) {
                return { type: 'pennant', level: 3, name };
            } else if (name.includes('metro')) {
                // Extract metro number if present (e.g., "Metro 1", "Metro 2")
                const metroMatch = name.match(/metro\s*(\d+)/);
                const metroLevel = metroMatch ? parseInt(metroMatch[1]) : 1;
                return { type: 'metro', level: metroLevel, name };
            }
            
            return { type: 'other', level: 999, name };
        };
        
        const orderA = getCompetitionOrder(nameA);
        const orderB = getCompetitionOrder(nameB);
        
        // First sort by competition type
        const typeOrder = { 'premier': 1, 'pennant': 2, 'metro': 3, 'other': 4 };
        if (typeOrder[orderA.type] !== typeOrder[orderB.type]) {
            return typeOrder[orderA.type] - typeOrder[orderB.type];
        }
        
        // Then sort by level within the same type
        if (orderA.level !== orderB.level) {
            return orderA.level - orderB.level;
        }
        
        // Finally sort alphabetically if same type and level
        return nameA.localeCompare(nameB);
    });
}

/**
 * Categorize competitions by type
 * @param {Array} competitions - Array of competition objects
 * @returns {Object} - Categorized competitions
 */
export function categorizeCompetitions(competitions) {
    const categories = {
        mens: [],
        womens: [],
        midweek: [],
        juniors: []
    };
    
    for (const competition of competitions) {
        const name = competition.name.toLowerCase();
        
        // Check categories in priority order
        if (COMPETITION_CATEGORIES.MIDWEEK.some(term => name.includes(term))) {
            categories.midweek.push(competition);
        } else if (COMPETITION_CATEGORIES.JUNIORS.some(term => name.includes(term))) {
            categories.juniors.push(competition);
        } else if (COMPETITION_CATEGORIES.WOMENS.some(term => name.includes(term))) {
            categories.womens.push(competition);
        } else if (COMPETITION_CATEGORIES.MENS.some(term => name.includes(term))) {
            categories.mens.push(competition);
        } else {
            console.warn(`Could not categorize competition: ${competition.name}`);
        }
    }
    
    // Apply custom sorting
    categories.mens = sortSeniorCompetitions(categories.mens);
    categories.womens = sortSeniorCompetitions(categories.womens);
    
    // Sort midweek and juniors alphabetically
    categories.midweek.sort((a, b) => a.name.localeCompare(b.name));
    categories.juniors.sort((a, b) => a.name.localeCompare(b.name));
    
    return categories;
}

/**
 * Filter competitions that have Google Calendar configured
 * @param {Array} competitions - Array of competition objects
 * @returns {Array} - Competitions with Google Calendar
 */
export function getCompetitionsWithCalendars(competitions) {
    return competitions.filter(comp => 
        comp.googleCalendar && comp.googleCalendar.calendarId
    );
}

/**
 * Filter competitions missing Google Calendar configuration
 * @param {Array} competitions - Array of competition objects
 * @returns {Array} - Competitions without Google Calendar
 */
export function getCompetitionsWithoutCalendars(competitions) {
    return competitions.filter(comp => 
        !comp.googleCalendar || !comp.googleCalendar.calendarId
    );
}

/**
 * Get statistics about competitions
 * @param {Array} competitions - Array of competition objects
 * @returns {Object} - Statistics object
 */
export function getCompetitionStats(competitions) {
    const categorized = categorizeCompetitions(competitions);
    const withCalendars = getCompetitionsWithCalendars(competitions);
    
    return {
        total: competitions.length,
        withCalendars: withCalendars.length,
        withoutCalendars: competitions.length - withCalendars.length,
        categories: {
            mens: categorized.mens.length,
            womens: categorized.womens.length,
            midweek: categorized.midweek.length,
            juniors: categorized.juniors.length
        }
    };
}

/**
 * Find competition by name (case insensitive)
 * @param {Array} competitions - Array of competition objects
 * @param {string} name - Competition name to search for
 * @returns {Object|null} - Found competition or null
 */
export function findCompetitionByName(competitions, name) {
    return competitions.find(comp => 
        comp.name.toLowerCase() === name.toLowerCase()
    ) || null;
}

/**
 * Extract calendar IDs from competitions
 * @param {Array} competitions - Array of competition objects
 * @returns {Array} - Array of calendar IDs
 */
export function extractCalendarIds(competitions) {
    return competitions
        .filter(comp => comp.googleCalendar && comp.googleCalendar.calendarId)
        .map(comp => comp.googleCalendar.calendarId);
}