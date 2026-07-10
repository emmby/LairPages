// Google Apps Script Configuration
const GH_OWNER = 'emmby';
const GH_REPO = 'LairPages';
const GH_BRANCH = 'main';
const GITHUB_PAT = 'YOUR_GITHUB_PERSONAL_ACCESS_TOKEN'; // Set in Script Properties for security!
const INBOX_FOLDER_ID = 'YOUR_GOOGLE_DRIVE_INBOX_FOLDER_ID';
const PROCESSED_FOLDER_ID = 'YOUR_GOOGLE_DRIVE_PROCESSED_FOLDER_ID'; // Optional, will create if empty

/**
 * Main entry point. Configure this to run on a time-driven trigger (e.g. Daily).
 */
function checkAndUploadSchedules() {
  const properties = PropertiesService.getScriptProperties();
  const pat = properties.getProperty('GITHUB_PAT') || GITHUB_PAT;
  const inboxFolderId = properties.getProperty('INBOX_FOLDER_ID') || INBOX_FOLDER_ID;
  let processedFolderId = properties.getProperty('PROCESSED_FOLDER_ID') || PROCESSED_FOLDER_ID;

  if (!pat || pat === 'YOUR_GITHUB_PERSONAL_ACCESS_TOKEN') {
    Logger.log('Error: GitHub PAT not configured. Please add GITHUB_PAT to Script Properties.');
    return;
  }
  if (!inboxFolderId || inboxFolderId === 'YOUR_GOOGLE_DRIVE_INBOX_FOLDER_ID') {
    Logger.log('Error: Google Drive Inbox Folder ID not configured. Please add INBOX_FOLDER_ID to Script Properties.');
    return;
  }

  const inboxFolder = DriveApp.getFolderById(inboxFolderId);
  const files = inboxFolder.getFiles();
  
  let processedFolder;
  if (processedFolderId && processedFolderId !== 'YOUR_GOOGLE_DRIVE_PROCESSED_FOLDER_ID') {
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
        
        // Clean filename for git path (replace spaces and special chars with underscores)
        const gitSafeFileName = fileName.replace(/[^a-zA-Z0-9_.-]/g, '_');
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
 * Helper to upload a base64 file to GitHub using the contents REST API.
 */
function uploadToGitHub(pat, gitPath, base64Content, commitMessage) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${gitPath}`;
  
  const payload = {
    message: commitMessage,
    content: base64Content,
    branch: GH_BRANCH
  };
  
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
