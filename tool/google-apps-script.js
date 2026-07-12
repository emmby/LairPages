/**
 * ============================================================================
 * GOOGLE DRIVE SCHEDULE INGESTION WATCHER
 * ============================================================================
 * 
 * INSTRUCTIONS FOR SETTING UP THIS SCRIPT:
 * 
 * 1. Go to Google Apps Script (https://script.google.com).
 * 2. Click "New Project" and rename it (e.g. "Lair Schedule Ingest Watcher").
 * 3. Paste the contents of this file into the editor, replacing all default code.
 * 4. Configure Script Properties for Credentials (DO NOT hardcode them in the script):
 *    - Click the gear icon (Project Settings) on the left sidebar.
 *    - Under "Script Properties", click "Add script property" and add:
 *      a. GITHUB_PAT : [Your GitHub Personal Access Token with repo write scope]
 *      b. INBOX_FOLDER_ID : [The Google Drive Folder ID of your schedule upload inbox]
 *      c. PROCESSED_FOLDER_ID (Optional) : [Google Drive Folder ID where processed PDFs go]
 *         * Note: If PROCESSED_FOLDER_ID is omitted, a folder named "Processed" will
 *                 automatically be created inside your Inbox folder.
 * 5. Configure the Trigger to Run Periodically:
 *    - Click the clock icon (Triggers) on the left sidebar.
 *    - Click "+ Add Trigger" in the bottom right corner.
 *    - Choose function to run: "checkAndUploadSchedules".
 *    - Select event source: "Time-driven".
 *    - Select type of time-based trigger: "Day timer" (recommend Daily in the morning, or "Hour timer" if needed).
 *    - Click "Save" and authorize the script permissions with your Google Account.
 * ============================================================================
 */

// Git Repository settings
const GH_OWNER = 'emmby';
const GH_REPO = 'LairPages';
const GH_BRANCH = 'main';

/**
 * Main entry point. Configure this to run on a time-driven trigger (e.g. Daily).
 */
function checkAndUploadSchedules() {
  const properties = PropertiesService.getScriptProperties();
  const pat = properties.getProperty('GITHUB_PAT');
  const inboxFolderId = properties.getProperty('INBOX_FOLDER_ID');
  let processedFolderId = properties.getProperty('PROCESSED_FOLDER_ID');

  if (!pat) {
    Logger.log('Error: GitHub PAT not configured. Please add GITHUB_PAT to Script Properties under Project Settings.');
    return;
  }
  if (!inboxFolderId) {
    Logger.log('Error: Google Drive Inbox Folder ID not configured. Please add INBOX_FOLDER_ID to Script Properties under Project Settings.');
    return;
  }

  const inboxFolder = DriveApp.getFolderById(inboxFolderId);
  const files = inboxFolder.getFiles();
  
  let processedFolder;
  if (processedFolderId) {
    processedFolder = DriveApp.getFolderById(processedFolderId);
  } else {
    // Create a "Processed" folder inside the Inbox folder if not specified
    const folders = inboxFolder.getFoldersByName('Processed');
    if (folders.hasNext()) {
      processedFolder = folders.next();
    } else {
      processedFolder = inboxFolder.createFolder('Processed');
    }
    processedFolderId = processedFolder.getId();
    properties.setProperty('PROCESSED_FOLDER_ID', processedFolderId);
  }

  let count = 0;
  while (files.hasNext()) {
    const file = files.next();
    const mimeType = file.getMimeType();
    
    // We only process PDF files
    if (mimeType === 'application/pdf') {
      const fileName = file.getName();
      Logger.log(`Found PDF: ${fileName}`);
      
      try {
        const fileBlob = file.getBlob();
        const base64Content = Utilities.base64Encode(fileBlob.getBytes());
        
        // Clean filename and append Google Drive file ID to ensure uniqueness in the inbox
        const fileId = file.getId();
        const dotIndex = fileName.lastIndexOf('.');
        const baseName = dotIndex !== -1 ? fileName.substring(0, dotIndex) : fileName;
        const ext = dotIndex !== -1 ? fileName.substring(dotIndex) : '';
        const gitSafeFileName = (baseName + '_' + fileId + ext).replace(/[^a-zA-Z0-9_.-]/g, '_');
        const gitPath = `schedules/inbox/${gitSafeFileName}`;
        
        // Upload to GitHub
        const success = uploadToGitHub(pat, gitPath, base64Content, `Upload ${fileName} from Google Drive`);
        
        if (success) {
          Logger.log(`Successfully uploaded ${fileName} to GitHub as ${gitPath}`);
          // Move file to Processed folder
          file.moveTo(processedFolder);
          Logger.log(`Moved ${fileName} to Processed folder.`);
          count++;
        } else {
          Logger.log(`Failed to upload ${fileName} to GitHub.`);
        }
      } catch (err) {
        Logger.log(`Error processing file ${fileName}: ${err.toString()}`);
      }
    }
  }
  
  Logger.log(`Finished run. Processed ${count} file(s).`);
}

/**
 * Helper to fetch the SHA of an existing file on GitHub if it exists.
 */
function getFileSha(pat, gitPath) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${gitPath}?ref=${GH_BRANCH}`;
  const options = {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    if (responseCode === 200) {
      const data = JSON.parse(response.getContentText());
      return data.sha;
    }
  } catch (err) {
    Logger.log(`Error checking file existence on GitHub: ${err.toString()}`);
  }
  return null;
}

/**
 * Helper to upload a base64 file to GitHub using the contents REST API.
 */
function uploadToGitHub(pat, gitPath, base64Content, commitMessage) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${gitPath}`;
  
  const payload = {
    message: commitMessage,
    content: base64Content,
    branch: GH_BRANCH
  };
  
  // Retrieve existing SHA if the file already exists on GitHub to prevent 422 errors
  const sha = getFileSha(pat, gitPath);
  if (sha) {
    payload.sha = sha;
  }
  
  const options = {
    method: 'PUT',
    contentType: 'application/json',
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();
  
  if (responseCode === 200 || responseCode === 201) {
    return true;
  } else {
    Logger.log(`GitHub API returned error ${responseCode}: ${responseText}`);
    return false;
  }
}
