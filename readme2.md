
# pre-requisites

google account

google cloud app


1. Create a Google Cloud Project
2. Enable the Google Calendar API
3. Create a Service Account
4. Download the service account key as service-account-key.json
5. Place it in the project root director


# Setup

## Generate a list of all competitions for your club

1. Run `npm run scrape-competitions`
2. Review the list is correct. Add / remove any un-required items

## Create the required Google Calendars
1. Run `npm run create-calendars`
2. You may recieve "Calendar usage limits exceeded" when running this for the first time
3. You can verify what calendar exist by running `npm run list-calendars`

# Updating Fixtures

## Interactive

`npm run process-fixture`

## Automated

`npm run process-fixture -- --steps download --force`

