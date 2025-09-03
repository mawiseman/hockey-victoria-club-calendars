import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const BASE_URL = 'https://www.hockeyvictoria.org.au/games/';
const CLUB_NAME = 'Footscray Hockey Club';
const OUTPUT_DIR = 'scraper-output';
const OUTPUT_FILE = `${OUTPUT_DIR}/footscray-competitions.json`;
const PROGRESS_FILE = `${OUTPUT_DIR}/scraper-progress.json`;
const MAX_CONCURRENT = 5;

/**
 * Load or create progress tracking data
 */
async function loadProgress() {
    try {
        const progressData = await fs.readFile(PROGRESS_FILE, 'utf8');
        return JSON.parse(progressData);
    } catch (error) {
        // File doesn't exist or is invalid, return default structure
        return {
            startedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            processedLinks: new Set(),
            foundCompetitions: [],
            totalLinksFound: 0,
            totalProcessed: 0,
            totalWithFootscray: 0
        };
    }
}

/**
 * Save progress data
 */
async function saveProgress(progress) {
    // Ensure output directory exists
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    
    // Convert Set to Array for JSON serialization
    const progressToSave = {
        ...progress,
        processedLinks: Array.from(progress.processedLinks),
        lastUpdated: new Date().toISOString()
    };
    
    await fs.writeFile(PROGRESS_FILE, JSON.stringify(progressToSave, null, 2), 'utf8');
}

/**
 * Load progress and convert processedLinks back to Set
 */
async function loadProgressWithSet() {
    const progress = await loadProgress();
    if (Array.isArray(progress.processedLinks)) {
        progress.processedLinks = new Set(progress.processedLinks);
    } else {
        progress.processedLinks = new Set();
    }
    return progress;
}

/**
 * Save competition result and update progress
 */
async function saveCompetitionResult(progress, competitionData) {
    if (competitionData) {
        progress.foundCompetitions.push(competitionData);
        progress.totalWithFootscray++;
        console.log(`✅ Saved competition: ${competitionData.name}`);
    }
    
    progress.totalProcessed++;
    
    // Save progress file
    await saveProgress(progress);
    
    // Ensure output directory exists and update the main output file
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    
    const outputData = {
        scrapedAt: progress.startedAt,
        lastUpdated: progress.lastUpdated,
        clubName: CLUB_NAME,
        totalCompetitions: progress.totalWithFootscray,
        totalProcessed: progress.totalProcessed,
        totalLinksFound: progress.totalLinksFound,
        competitions: progress.foundCompetitions
    };
    
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(outputData, null, 2), 'utf8');
}

/**
 * Process competitions in parallel with concurrency limit
 */
async function processCompetitionsInParallel(browser, competitionLinks, progress) {
    const pendingLinks = competitionLinks.filter(link => !progress.processedLinks.has(link.url));
    
    if (pendingLinks.length === 0) {
        console.log('✅ All competitions already processed!');
        return;
    }
    
    console.log(`📋 Resuming: ${pendingLinks.length} competitions remaining to process`);
    console.log(`📊 Progress: ${progress.totalProcessed}/${progress.totalLinksFound} processed, ${progress.totalWithFootscray} with Footscray`);
    
    // Process in batches with concurrency limit
    for (let i = 0; i < pendingLinks.length; i += MAX_CONCURRENT) {
        const batch = pendingLinks.slice(i, i + MAX_CONCURRENT);
        
        console.log(`\n🔄 Processing batch ${Math.floor(i / MAX_CONCURRENT) + 1}: competitions ${i + 1}-${Math.min(i + MAX_CONCURRENT, pendingLinks.length)}`);
        
        // Create pages for this batch
        const pages = await Promise.all(
            batch.map(async () => await browser.newPage())
        );
        
        // Process batch in parallel
        const batchPromises = batch.map(async (link, index) => {
            const page = pages[index];
            try {
                console.log(`\n[${i + index + 1}/${pendingLinks.length}] Checking: ${link.text}`);
                
                const competitionData = await checkCompetition(page, link);
                
                // Mark as processed
                progress.processedLinks.add(link.url);
                
                // Save result
                await saveCompetitionResult(progress, competitionData);
                
                if (competitionData) {
                    console.log(`✓ Found Footscray in: ${competitionData.name}`);
                } else {
                    console.log(`✗ Footscray not found in: ${link.text}`);
                }
                
                return competitionData;
                
            } catch (error) {
                console.error(`❌ Error processing ${link.text}: ${error.message}`);
                
                // Still mark as processed to avoid retrying
                progress.processedLinks.add(link.url);
                await saveProgress(progress);
                
                return null;
            } finally {
                await page.close();
            }
        });
        
        await Promise.all(batchPromises);
        
        // Add delay between batches to be respectful
        if (i + MAX_CONCURRENT < pendingLinks.length) {
            console.log(`⏳ Waiting 2 seconds before next batch...`);
            // await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

/**
 * Scrape all competitions and find those containing Footscray Hockey Club
 */
async function scrapeCompetitions() {
    // Load or create progress
    const progress = await loadProgressWithSet();
    
    const browser = await puppeteer.launch({ 
        headless: false, // Set to true for production
        slowMo: 100 // Add delay between actions
    });
    
    try {
        const page = await browser.newPage();
        
        console.log('📂 Loading progress...');
        console.log(`📊 Previous session: ${progress.totalProcessed} processed, ${progress.totalWithFootscray} with Footscray`);
        
        console.log('\n🌐 Navigating to Hockey Victoria games page...');
        await page.goto(BASE_URL, { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        // Wait a bit more for dynamic content to load
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Get all competition links
        const competitionLinks = await getCompetitionLinks(page);
        console.log(`\n🔍 Found ${competitionLinks.length} competition links on games page`);
        
        // Update progress with total found (only if this is a new run)
        if (progress.totalLinksFound === 0) {
            progress.totalLinksFound = competitionLinks.length;
            await saveProgress(progress);
        }
        
        // Close the initial page since we'll create new ones for parallel processing
        await page.close();
        
        // Process competitions in parallel
        await processCompetitionsInParallel(browser, competitionLinks, progress);
        
        console.log(`\n🎉 Complete! Found ${progress.totalWithFootscray} competitions with Footscray Hockey Club`);
        console.log(`📊 Total processed: ${progress.totalProcessed}/${progress.totalLinksFound}`);
        console.log(`💾 Results saved to ${OUTPUT_FILE}`);
        console.log(`📋 Progress saved to ${PROGRESS_FILE}`);
        
    } finally {
        await browser.close();
    }
}

/**
 * Extract all competition links from the main games page
 */
async function getCompetitionLinks(page) {
    return await page.evaluate(() => {
        const links = [];
        const competitionElements = document.querySelectorAll('a[href*="/games/"]');
        
        competitionElements.forEach(element => {
            const href = element.getAttribute('href');
            const text = element.textContent.trim();
            
            if (href && text) {
                const fullUrl = href.startsWith('/') ? `https://www.hockeyvictoria.org.au${href}` : href;
                
                // Exclude links with specific titles
                const excludedTitles = ['Download', 'Statistics'];
                const isExcluded = excludedTitles.some(excludedTitle => 
                    text.toLowerCase().includes(excludedTitle.toLowerCase())
                );
                
                // Only include URLs that are children of /games/ (not just /games/ itself) and not excluded
                if (fullUrl.includes('/games/') && 
                    fullUrl !== 'https://www.hockeyvictoria.org.au/games/' && 
                    fullUrl.length > 'https://www.hockeyvictoria.org.au/games/'.length &&
                    !isExcluded) {
                    links.push({
                        url: fullUrl,
                        text: text
                    });
                }
            }
        });
        
        // Remove duplicates
        const unique = links.filter((link, index, self) => 
            index === self.findIndex(l => l.url === link.url)
        );
        
        return unique;
    });
}

/**
 * Find ladder/pointscore links from a competition page
 */
async function getLadderLinks(page) {
    return await page.evaluate(() => {
        const links = [];
        
        // Look for "View ladder" links or direct /pointscore/ links
        const ladderSelectors = [
            'a[href*="/pointscore/"]',
            'a:contains("View ladder")',
            'a:contains("Ladder")',
            'a:contains("Points")'
        ];
        
        ladderSelectors.forEach(selector => {
            const elements = selector.includes(':contains') 
                ? Array.from(document.querySelectorAll('a')).filter(el => 
                    el.textContent.toLowerCase().includes(selector.split('"')[1].toLowerCase())
                  )
                : document.querySelectorAll(selector);
                
            elements.forEach(element => {
                const href = element.getAttribute('href');
                const text = element.textContent.trim();
                
                if (href && text) {
                    const fullUrl = href.startsWith('/') ? `https://www.hockeyvictoria.org.au${href}` : href;
                    
                    if (fullUrl.includes('/pointscore/')) {
                        links.push({
                            url: fullUrl,
                            text: text
                        });
                    }
                }
            });
        });
        
        // Remove duplicates
        const unique = links.filter((link, index, self) => 
            index === self.findIndex(l => l.url === link.url)
        );
        
        return unique;
    });
}

/**
 * Check if a competition contains Footscray Hockey Club and extract data
 * This now follows a 3-layer navigation: games page → competition page → ladder page
 */
async function checkCompetition(page, competitionLink) {
    try {
        console.log(`  → Visiting competition page: ${competitionLink.url}`);
        
        // Step 1: Navigate to the competition page
        await page.goto(competitionLink.url, { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        // Wait for content to load
        // await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Step 2: Find ladder/pointscore links on the competition page
        const ladderLinks = await getLadderLinks(page);
        
        if (ladderLinks.length === 0) {
            console.log(`    ✗ No ladder links found on competition page`);
            return null;
        }
        
        console.log(`    Found ${ladderLinks.length} ladder link(s)`);
        
        // Step 3: Check each ladder page for Footscray Hockey Club
        for (const ladderLink of ladderLinks) {
            console.log(`    → Checking ladder: ${ladderLink.url}`);
            
            try {
                // Navigate to the ladder page
                await page.goto(ladderLink.url, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 30000 
                });
                
                // Wait for content to load
                // await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Check if Footscray Hockey Club is present in the ladder and find fixture URL
                const footscrayData = await page.evaluate((clubName) => {
                    console.log(`Searching for: ${clubName}`);
                    
                    // First, check if the club name exists on the page
                    const allElements = document.querySelectorAll('*');
                    let clubFound = false;
                    let debugInfo = [];
                    
                    for (const element of allElements) {
                        if (element.textContent && element.textContent.includes(clubName)) {
                            clubFound = true;
                            console.log(`Found club in element: ${element.tagName}, text: ${element.textContent.trim()}`);
                            
                            // Try multiple strategies to find the team link
                            let fixtureUrl = null;
                            
                            // Strategy 1: Element itself is a team link
                            if (element.tagName === 'A' && element.href.includes('/team/')) {
                                fixtureUrl = element.href;
                                console.log(`Strategy 1 success: ${fixtureUrl}`);
                                return { found: true, fixtureUrl, strategy: 'direct_link' };
                            }
                        }
                    }
                    
                    if (clubFound) {
                        console.log(`Club found but no team link found. Debug info:`, debugInfo);
                        // If club is found but no fixture URL, still return found=true but with null fixtureUrl
                        return { found: true, fixtureUrl: null, strategy: 'no_link_found', debugInfo };
                    }
                    
                    console.log(`Club not found on page`);
                    return { found: false };
                }, CLUB_NAME);
                
                if (footscrayData.found) {
                    console.log(`      ✓ Found ${CLUB_NAME} in ladder!`);
                    
                    if (footscrayData.fixtureUrl) {
                        console.log(`      ✓ Fixture URL: ${footscrayData.fixtureUrl}`);
                        return {
                            name: competitionLink.text, // Use the original competition link text from start page
                            fixtureUrl: footscrayData.fixtureUrl,
                            competitionUrl: competitionLink.url,
                            ladderUrl: ladderLink.url,
                            scrapedAt: new Date().toISOString()
                        };
                    } else {
                        console.log(`      ⚠️ Club found but no fixture URL found (strategy: ${footscrayData.strategy})`);
                        if (footscrayData.debugInfo) {
                            console.log(`      Debug info:`, footscrayData.debugInfo);
                        }
                        return null; // Don't save entries without fixture URLs
                    }
                } else {
                    console.log(`      ✗ ${CLUB_NAME} not found in this ladder`);
                }
                
            } catch (ladderError) {
                console.error(`      Error checking ladder ${ladderLink.url}: ${ladderError.message}`);
            }
        }
        
        return null; // No ladders contained Footscray Hockey Club
        
    } catch (error) {
        console.error(`  Error processing competition ${competitionLink.url}: ${error.message}`);
        return null;
    }
}


/**
 * Main execution
 */
async function main() {
    try {
        await scrapeCompetitions();
    } catch (error) {
        console.error('Script failed:', error.message);
        process.exit(1);
    }
}

// Run the script if called directly
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (process.argv[1] === __filename) {
    main();
}

export { scrapeCompetitions, getCompetitionLinks, getLadderLinks, checkCompetition };