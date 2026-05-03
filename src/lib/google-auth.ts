import { google } from 'googleapis';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';

export const createOAuth2Client = () => {
  return new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
  );
};

// Scope duy nhất cần thiết để đọc Gmail
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
];
