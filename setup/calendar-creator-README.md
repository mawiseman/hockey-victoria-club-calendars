# Google Calendar Creator

This script automatically creates public Google Calendars for each Footscray Hockey Club competition found by the competition scraper.

## Prerequisites

1. **Google Cloud Setup:**
   - Create a Google Cloud Project
   - Enable the Google Calendar API
   - Create a Service Account with Calendar permissions
   - Download the service account key as `service-account-key.json`
   - Place the key file in the project root directory

2. **Competition Data:**
   - Run the competition scraper first: `npm run scrape-competitions`
   - Ensure `config/competitions.json` exists

## Usage

```bash
npm run create-calendars
```

## What it does

1. **Reads competition data** from `config/competitions.json`
2. **Creates public Google Calendars** for each competition that doesn't already have one
3. **Applies naming convention**: Prepends "FHC " to each competition name
4. **Sets calendar visibility** to public (readable by anyone)
5. **Updates the JSON file** with calendar information:
   - Calendar ID
   - Public embed URL
   - Creation timestamp

## Output Structure

After running, each competition in the JSON file will have a `googleCalendar` property:

```json
{
  "name": "2025 Senior Competition Women's Premier League",
  "fixtureUrl": "https://www.hockeyvictoria.org.au/games/team/37285",
  "competitionUrl": "https://www.hockeyvictoria.org.au/games/21935",
  "ladderUrl": "https://www.hockeyvictoria.org.au/pointscore/21935",
  "scrapedAt": "2025-01-15T10:30:15.000Z",
  "googleCalendar": {
    "calendarId": "abc123@group.calendar.google.com",
    "publicUrl": "https://calendar.google.com/calendar/embed?src=abc123%40group.calendar.google.com",
    "title": "FHC 2025 Senior Competition Women's Premier League",
    "createdAt": "2025-01-15T11:15:30.000Z"
  }
}
```

## Features

- **Incremental creation**: Only creates calendars for competitions that don't already have them
- **Rate limiting**: Adds delays between API calls to respect Google's rate limits
- **Error handling**: Continues processing other competitions if one fails
- **Public visibility**: All calendars are automatically made publicly viewable
- **Progress tracking**: Shows detailed progress and results

## Calendar Properties

- **Name**: "FHC " + original competition name
- **Description**: "Footscray Hockey Club fixtures for {competition name}"
- **Timezone**: Australia/Melbourne
- **Visibility**: Public (readable by anyone with the link)

## Google Cloud Permissions

The service account needs the following permissions:
- `https://www.googleapis.com/auth/calendar`

## Example Output

```
🚀 Starting Google Calendar creation process...

📂 Loading competition data...
📊 Found 8 competitions
📅 Creating calendars for 3 competitions...

🔐 Initializing Google Calendar API...
✅ Google Calendar API initialized

[1/3] Processing: 2025 Senior Competition Women's Premier League
📅 Creating calendar: FHC 2025 Senior Competition Women's Premier League
✅ Created calendar with ID: abc123@group.calendar.google.com
🌐 Made calendar public
📋 Public URL: https://calendar.google.com/calendar/embed?src=abc123%40group.calendar.google.com

🎉 Successfully created 3 Google Calendars!
```

## Troubleshooting

- **"service-account-key.json not found"**: Download the service account key from Google Cloud Console
- **"Permission denied"**: Ensure the service account has Calendar API permissions
- **"API not enabled"**: Enable the Google Calendar API in Google Cloud Console
- **"Competition file not found"**: Run `npm run scrape-competitions` first