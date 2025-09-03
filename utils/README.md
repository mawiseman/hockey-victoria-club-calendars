# Competition Scraper

This script automatically discovers Hockey Victoria competitions that include Footscray Hockey Club.

## Usage

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the scraper:
   ```bash
   npm run scrape-competitions
   ```

## What it does

1. **Navigates to** https://www.hockeyvictoria.org.au/games/
2. **Finds all competition links** (those containing `/pointscore/`)
3. **Visits each competition's ladder page**
4. **Checks for "Footscray Hockey Club"** in the team listings
5. **Extracts competition data**:
   - Competition name (e.g. "2025 Senior Competition · Women's Premier League - 2025")
   - Competition ID from URL (e.g. "21935" from `/pointscore/21935`)
   - Team Competition ID from team link (e.g. "37285" from `/team/37285`)

## Output

The script generates files in the `scraper-output/` folder:
- `scraper-output/footscray-competitions.json` - Final competition results
- `scraper-output/scraper-progress.json` - Progress tracking for resumption

The main results file has the following structure:

```json
{
  "scrapedAt": "2025-01-15T10:30:00.000Z",
  "clubName": "Footscray Hockey Club", 
  "totalCompetitions": 5,
  "competitions": [
    {
      "name": "2025 Senior Competition · Women's Premier League - 2025",
      "competitionId": "21935",
      "teamCompetitionId": "37285",
      "ladderUrl": "https://www.hockeyvictoria.org.au/pointscore/21935",
      "teamUrl": "https://www.hockeyvictoria.org.au/team/37285",
      "scrapedAt": "2025-01-15T10:30:15.000Z"
    }
  ]
}
```

## Configuration

You can modify these constants in `competition-scraper.js`:

- `CLUB_NAME`: The club to search for (default: "Footscray Hockey Club")
- `OUTPUT_DIR`: Where to save results (default: "scraper-output")
- `MAX_CONCURRENT`: Number of parallel processes (default: 5)

## Browser Settings

- The script runs in **non-headless mode** by default to help with debugging
- Set `headless: true` in the puppeteer launch options for production use
- Includes respectful delays between requests (1 second)

## Notes

- **Output is ignored by git** - The `scraper-output/` folder is automatically excluded from version control
- **Resumable execution** - The script can be safely interrupted and resumed from where it left off
- **Progressive saving** - Results are saved immediately as they're found, so no progress is lost
- **Parallel processing** - Up to 5 competitions are processed simultaneously for faster execution
- The script does not overwrite existing competition configuration files
- It's designed to help generate new competition entries for the main application
- Use the output to manually create entries in your competition configuration files