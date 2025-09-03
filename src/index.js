import fs from 'fs/promises';
import path from 'path';
import { downloadAllCalendars } from './calendar-downloader.js';
import { processAllCalendars } from './calendar-processor.js';
import { uploadAllCalendars } from './google-calendar.js';

/**
 * Main orchestration function
 */
async function main() {
    console.log('========================================');
    console.log('Hockey Victoria Calendar Scraper');
    console.log(`Started at: ${new Date().toISOString()}`);
    console.log('========================================\n');
    
    try {
        // Load configuration
        const competitionsConfig = JSON.parse(
            await fs.readFile('./config/competitions.json', 'utf8')
        );
        
        const { competitions } = competitionsConfig;
        
        // Create temp directories
        const tempDir = './temp';
        const downloadDir = path.join(tempDir, 'downloads');
        const processedDir = path.join(tempDir, 'processed');
        
        await fs.mkdir(downloadDir, { recursive: true });
        await fs.mkdir(processedDir, { recursive: true });
        
        // Step 1: Download all calendars
        console.log('\n=== STEP 1: Downloading Calendars ===\n');
        const downloadResults = await downloadAllCalendars(competitions, downloadDir);
        
        // Check download results
        const downloadedCount = Object.values(downloadResults).filter(r => r.success).length;
        console.log(`\nDownloaded ${downloadedCount}/${competitions.length} calendars successfully`);
        
        // Step 2: Process all calendars
        console.log('\n=== STEP 2: Processing Calendars ===\n');
        const processResults = await processAllCalendars(
            downloadResults,
            processedDir
        );
        
        // Check process results
        const processedCount = Object.values(processResults).filter(r => r.success).length;
        console.log(`\nProcessed ${processedCount}/${competitions.length} calendars successfully`);
        
        // Step 3: Upload to Google Calendar (only if GOOGLE_SERVICE_ACCOUNT_KEY is set)
        if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
            console.log('\n=== STEP 3: Uploading to Google Calendar ===\n');
            const uploadResults = await uploadAllCalendars(processResults);
            
            // Generate summary report
            console.log('\n========================================');
            console.log('SUMMARY REPORT');
            console.log('========================================\n');
            
            let totalSuccess = 0;
            let totalFailed = 0;
            
            for (const [name, result] of Object.entries(uploadResults)) {
                if (result.success) {
                    totalSuccess++;
                    console.log(`✅ ${name}: Successfully uploaded`);
                    if (result.calendars) {
                        for (const cal of result.calendars) {
                            if (cal.success) {
                                console.log(`   - ${cal.calendarId}: ${cal.imported} events`);
                            } else {
                                console.log(`   - ${cal.calendarId}: FAILED - ${cal.error}`);
                            }
                        }
                    }
                } else {
                    totalFailed++;
                    console.log(`❌ ${name}: Failed - ${result.error}`);
                }
            }
            
            console.log('\n----------------------------------------');
            console.log(`Total: ${totalSuccess} succeeded, ${totalFailed} failed`);
        } else {
            console.log('\n=== STEP 3: Skipping Google Calendar Upload ===');
            console.log('GOOGLE_SERVICE_ACCOUNT_KEY environment variable not set');
            console.log('Processed calendars are available in:', processedDir);
        }
        
        // Clean up temp files (optional - comment out if you want to keep them)
        if (process.env.CLEANUP_TEMP !== 'false') {
            console.log('\nCleaning up temporary files...');
            await fs.rm(tempDir, { recursive: true, force: true });
        }
        
        console.log('\n========================================');
        console.log(`Completed at: ${new Date().toISOString()}`);
        console.log('========================================');
        
    } catch (error) {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    }
}

// Run the main function
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});