# Setup Guide

This guide covers the prerequisites and setup steps needed to run the Hockey Victoria calendar scraper.

## Prerequisites

### 1. Configuration Setup

Edit `config/settings.json` to configure your club:

```json
{
  "clubName": "Footscray Hockey Club",
  "calendarPrefix": "FHC "
}
```

- **clubName**: Full name of your hockey club (used for scraping competitions)
- **calendarPrefix**: Prefix for Google Calendar names (keeps calendars organized)

### 2. Google Calendar API Setup

#### Step 1: Create a Google Cloud Project
1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Click **Create Project** (or select an existing project)
3. Give your project a name (e.g., "hockey-victoria-calendars")
4. Click **Create**

#### Step 2: Enable the Google Calendar API
1. In the Google Cloud Console, go to **APIs & Services** → **Library**
2. Search for "Google Calendar API"
3. Click on it and then click **Enable**

#### Step 3: Create a Service Account
1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **Service Account**
3. Fill in the details:
   - **Service account name**: `hockey-calendar-service` (or similar)
   - **Service account ID**: This will auto-generate
   - **Description**: "Service account for Hockey Victoria calendar automation"
4. Click **Create and Continue**
5. Skip the optional steps (you can add roles later if needed)
6. Click **Done**

#### Step 4: Generate Service Account Key
1. In the **Credentials** page, find your new service account in the list
2. Click on the service account name
3. Go to the **Keys** tab
4. Click **Add Key** → **Create new key**
5. Select **JSON** as the key type
6. Click **Create**
7. The JSON file will download automatically
8. Rename it to `service-account-key.json` and place it in the project root directory

**If you already have a service account key:**
1. Go to **APIs & Services** → **Credentials**
2. Find your existing service account in the list
3. Click on the service account name
4. Go to the **Keys** tab
5. In the **Key ID** column, click the **Download** button (looks like a download icon) for an existing key
6. If no keys exist, follow the steps above to create a new key
7. Rename the downloaded JSON file to `service-account-key.json` and place it in the project root directory

#### Step 5: Grant Calendar Access (Important!)

Since this is a service account, you need to give it access to create and manage Google Calendars. You have two options:

**Option A: Domain-wide delegation (if you control a Google Workspace domain)**
- This allows the service account to act on behalf of users in your domain
- Enable domain-wide delegation in the service account settings
- Add the necessary scopes in your Google Workspace admin console

**Option B: Share calendars manually (recommended for personal use)**
- After creating calendars with the script, you'll need to share them publicly or with specific users
- The script creates public calendars by default, so they can be subscribed to by anyone

#### Step 6: Test Your Setup

```bash
npm run list-calendars
```

If successful, it should list your Google Calendars (or show an empty list if you have none).

#### Security Notes
- Keep the `service-account-key.json` file secure and never commit it to version control
- Add it to your `.gitignore` file if it's not already there
- The service account will have access to create and modify Google Calendars, so use it responsibly

#### Troubleshooting Authentication Errors
- Verify the `service-account-key.json` file is in the project root
- Check that the Google Calendar API is enabled
- Ensure your Google Cloud project has billing enabled (required for Calendar API usage)
- Confirm the service account has the necessary permissions

### 3. Node.js Dependencies

```bash
npm install
```