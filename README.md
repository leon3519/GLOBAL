# Global Interview — Telegram-only edition (no Supabase)

## What it does
- Employer enters company name/address, interviewer name, candidate name and position.
- Employer uploads company logo and edits spoken interview questions.
- Website generates a unique interview URL.
- Candidate opens the URL; questions are read aloud by browser text-to-speech.
- Candidate records a video answer for each question and can review/re-record it.
- Videos and interview metadata are sent directly to the configured Telegram chat via a Netlify Function.
- No database or Supabase is used.

## Deploy on Netlify
1. Upload/deploy the entire project folder to Netlify (not just `index.html`).
2. In Netlify: Site configuration → Environment variables, add:
   - `TELEGRAM_BOT_TOKEN` = token from @BotFather
   - `TELEGRAM_CHAT_ID` = destination private chat or group ID
3. Trigger a new deploy after adding the variables.
4. Open the deployed site over HTTPS. Browser camera and microphone require HTTPS.
5. Create a test interview, open its link in a second browser/device, grant camera/mic permission, record short test answers, submit and verify Telegram delivery.

## Create the Telegram bot/chat
1. Open Telegram and contact @BotFather; send `/newbot`; follow instructions; copy token.
2. Open your bot and press Start.
3. Send the bot a test message.
4. To find private chat ID, visit `https://api.telegram.org/bot<TOKEN>/getUpdates` in your browser and read `message.chat.id`. Keep the token secret. For a group, add the bot, send a group message, then inspect the update for the group chat ID (usually a negative number).
5. Set token and chat ID as Netlify environment variables. Never paste the bot token into the website code or share it publicly.

## Technical limitations to understand
- This version uses a self-contained interview link. Interview details, questions and company logo are encoded in the URL fragment. URL fragments are not sent to the web server, and there is no database. Anyone who has the link can view the interview details; treat links as confidential. The link can be forwarded and is not single-use.
- Link payload size depends on the logo; keep logos under 2 MB. Use a small, optimized PNG/JPG/WEBP logo.
- Video upload goes through Netlify Function request body limits and Telegram bot API limits. This implementation caps each answer at 18 MB and total request at 48 MB. Keep answers short (roughly 1–2 minutes at moderate resolution; actual size depends on browser/device). Netlify plan/request limits may be lower or change, so test on your account.
- Telegram Bot API `sendVideo` accepts video formats supported by Telegram. Browser MediaRecorder normally outputs WebM; some Telegram clients/API paths may reject WebM as a video. If Telegram rejects the format, use a browser/device that can record MP4 or add server-side transcoding (not included in this free, no-database version). Do not assume successful delivery until you test on your target phones.
- No resumable upload: keep candidate on page until submission finishes. A failed upload needs retrying the interview.
- The website does not independently verify employer identity, candidate identity, company existence or job legitimacy.
- Add a clear privacy notice and consent. Obtain permission before recording and sharing candidate videos. Set a retention/deletion policy. Comply with applicable privacy and employment laws in the countries where recruiters and candidates are located.
- This is a prototype. Add rate limiting, signed/expiring interview tokens and abuse protection before production use. Because there is no database, revocation and one-time-use links are not supported.
