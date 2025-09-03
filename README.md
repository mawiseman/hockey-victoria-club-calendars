# Hockey Victoria Calendar Scraper - GitHub Actions Version

This is a Node.js implementation of the Hockey Victoria Calendar Scraper designed to run entirely on GitHub Actions. It automatically downloads, processes, and uploads hockey fixtures to Google Calendar.

## Features

- ✅ Downloads iCal calendars from Hockey Victoria website
- ✅ Processes events to improve readability (club abbreviations, simplified competition names)
- ✅ Uploads to multiple Google Calendars
- ✅ Runs automatically via GitHub Actions (daily schedule)
- ✅ Configurable via JSON files
- ✅ No local infrastructure required

## Project Structure

```
src-actions/
├── config/                      # Configuration files
│   ├── competitions.json        # Competition definitions and calendar mappings
│   ├── mappings-club-names.json       # Club name to abbreviation mappings
│   └── mappings-competition-names.json   # Competition name replacements
├── src/                         # Source code
│   ├── index.js                 # Main orchestration script
│   ├── calendar-downloader.js   # Downloads iCal files
│   ├── calendar-processor.js    # Processes calendar events
│   └── google-calendar.js       # Google Calendar API integration
├── package.json                 # Node.js dependencies
└── README.md                    # This file

.github/workflows/
└── sync-calendars.yml          # GitHub Actions workflow
```

## Setup Instructions

### 1. Create Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the Google Calendar API
4. Create a Service Account:
   - Go to "IAM & Admin" → "Service Accounts"
   - Click "Create Service Account"
   - Give it a name (e.g., "hockey-calendar-sync")
   - Grant it the "Editor" role
   - Create and download a JSON key

### 2. Grant Calendar Access

For each Google Calendar that needs to be updated:

1. Open Google Calendar
2. Go to Calendar Settings
3. Share the calendar with the service account email (found in the JSON key)
4. Grant "Make changes to events" permission

### 3. Configure GitHub Repository

1. Go to your GitHub repository
2. Navigate to Settings → Secrets and variables → Actions
3. Add a new repository secret:
   - Name: `GOOGLE_SERVICE_ACCOUNT_KEY`
   - Value: Paste the entire contents of the service account JSON key

### 4. Configure Competitions

Edit the configuration files in `src-actions/config/`:

#### competitions.json
- Add/remove competitions
- Update calendar IDs
- Modify category assignments

#### mappings-club-names.json
- Add new clubs and their abbreviations
- Update existing abbreviations

#### mappings-competition-names.json
- Modify competition name replacements
- Add new patterns for round/competition names

## Usage

### Automatic Execution

The workflow runs automatically:
- **Schedule**: Daily at 2 AM Melbourne time
- **Manual**: Go to Actions tab → Select "Sync Hockey Victoria Calendars" → Run workflow

### Local Testing

```bash
cd src-actions
npm install

# Set environment variable (Linux/Mac)
export GOOGLE_SERVICE_ACCOUNT_KEY='<paste-json-key-here>'

# Set environment variable (Windows PowerShell)
$env:GOOGLE_SERVICE_ACCOUNT_KEY='<paste-json-key-here>'

# Run the sync
npm start
```

### Manual Trigger via GitHub

1. Go to the Actions tab in your repository
2. Select "Sync Hockey Victoria Calendars"
3. Click "Run workflow"
4. Choose options:
   - Cleanup temp files: Yes/No

## Configuration

### Adding a New Competition

1. Edit `src-actions/config/competitions.json`:
```json
{
  "name": "Competition Name",
  "competitionId": "12345/67890",
  "calendars": [
    "calendar_id_1@group.calendar.google.com",
    "calendar_id_2@group.calendar.google.com"
  ],
  "category": "men|women|juniors|midweek"
}
```

2. Commit and push changes
3. The next scheduled run will include the new competition

### Modifying Club Names

Edit `src-actions/config/mappings-club-names.json`:
```json
{
  "clubMappings": {
    "Full Club Name": "ABC",
    "Another Club Name": "XYZ"
  }
}
```

### Adjusting Schedule

Edit `.github/workflows/sync-calendars.yml`:
```yaml
on:
  schedule:
    - cron: '0 16 * * *'  # Modify this line
```

Use [crontab.guru](https://crontab.guru/) to generate cron expressions.

## Monitoring

### Check Workflow Status

1. Go to Actions tab
2. View recent workflow runs
3. Click on a run to see detailed logs

### Failure Notifications

When a sync fails:
- An issue is automatically created in the repository
- Temporary files are uploaded as artifacts for debugging

## Troubleshooting

### Common Issues

1. **Authentication Failed**
   - Verify `GOOGLE_SERVICE_ACCOUNT_KEY` secret is set correctly
   - Ensure service account has calendar access

2. **Calendar Not Found**
   - Check calendar IDs in competitions.json
   - Verify service account has access to the calendar

3. **Events Not Appearing**
   - Check timezone settings
   - Verify events are within the correct date range

4. **Download Failed**
   - Check Hockey Victoria website is accessible
   - Verify competition IDs are correct

### Debug Mode

To keep temporary files for debugging:
1. Run workflow manually
2. Set "Clean up temporary files" to "false"
3. Download artifacts from the workflow run

## Environment Variables

- `GOOGLE_SERVICE_ACCOUNT_KEY`: Google service account credentials (required)
- `CLEANUP_TEMP`: Whether to delete temporary files after sync (default: true)

## Dependencies

- `@googleapis/calendar`: Google Calendar API client
- `ical`: iCal parsing library
- `node-fetch`: HTTP client for downloading calendars
- `dotenv`: Environment variable management

## Security Notes

- Never commit the service account key to the repository
- Use GitHub Secrets for sensitive information
- Regularly rotate service account keys
- Limit calendar permissions to minimum required

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test locally
5. Submit a pull request

## License

MIT

## Support

For issues or questions:
1. Check existing GitHub Issues
2. Create a new issue with:
   - Description of the problem
   - Error messages from logs
   - Configuration details (without sensitive data)




# 1. Download all fixtures (takes time)
  npm start -- --steps download

  # 2. Test processing with different settings
  npm start -- --steps process --force

  # 3. Upload when satisfied
  npm start -- --steps upload

  Production Workflow:

  # Full pipeline (default)
  npm start

  # Or force fresh run
  npm start -- --force

  Troubleshooting:

  # Re-process with new settings
  npm start -- --steps process --force

  # Skip problematic download, just upload
  npm start -- --steps upload