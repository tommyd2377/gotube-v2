# GoTube

GoTube is a private, one-user YouTube client built for intentional viewing. It has search, a private channel list, a reverse-chronological feed, Watch Later, watched state, Shorts filtering, and a Fire TV-friendly `/tv` route.

It intentionally does not include recommendations, Trending, Home, comments, Shorts feeds, Google OAuth, YouTube account subscriptions, YouTube Watch Later, YouTube history, analytics, billing, payments, or social features.

The Feed loads the latest 20 synced videos first, then uses an intentional Load Older button for the next 20 at a time.

## Do Not Pay For Anything

Use free-tier services only. If YouTube, Supabase, Cloudflare, or any other provider asks for billing information, a credit card, paid quota, a subscription, or a paid tier, stop and leave that step manual. Do not enter payment information.

## Architecture

- `apps/web`: Vite, React, TypeScript, Dexie/IndexedDB.
- `worker`: Cloudflare Worker API proxy under `/api`.
- `supabase/schema.sql`: Supabase Postgres schema.
- YouTube API keys and Supabase service-role keys live only in Worker environment variables.
- The frontend stores only the private GoTube sync key entered by the user and sends it as `x-gotube-sync-key`.

## Local Development

Install dependencies:

```bash
npm install
```

Start the Worker API:

```bash
npm run dev:worker
```

Start the Vite app in a second terminal:

```bash
npm run dev:web
```

Open:

- Standard UI: `http://127.0.0.1:5173/`
- TV UI: `http://127.0.0.1:5173/tv`

Before using search, channel sync, Feed, Watch Later, or watched state, configure real local Worker secrets in `worker/.dev.vars`:

```text
YOUTUBE_API_KEY=your_free_youtube_data_api_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GOTUBE_SYNC_KEY=your_private_passphrase
```

Enter the same `GOTUBE_SYNC_KEY` in GoTube Settings. GoTube does not serve mock YouTube data; missing Worker configuration returns an explicit error.

## Environment Files

Frontend example:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Worker example:

```bash
cp worker/.dev.vars.example worker/.dev.vars
```

Worker variables:

```text
YOUTUBE_API_KEY=your_free_youtube_data_api_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GOTUBE_SYNC_KEY=your_private_passphrase
```

Never commit `.env`, `.env.local`, `.dev.vars`, API keys, service-role keys, tokens, or secrets.

## YouTube API Key

1. Create or use a Google Cloud project.
2. Enable the YouTube Data API v3.
3. Create an API key.
4. Restrict the key as appropriate for server-side use.
5. Put it in the Worker environment as `YOUTUBE_API_KEY`.

Do not connect a personal YouTube account. GoTube does not use Google OAuth and does not read YouTube subscriptions, Watch Later, or history.

## Supabase Free Project

1. Create a free Supabase project.
2. Open the SQL editor.
3. Run the full contents of `supabase/schema.sql`.
4. Copy the project URL into `SUPABASE_URL`.
5. Copy the service role key into `SUPABASE_SERVICE_ROLE_KEY`.

The schema enables RLS and does not create public browser write policies. The Worker is the gatekeeper and uses the service-role key server-side.

## Cloudflare Free Tier

Worker local dev:

```bash
npm run dev:worker
```

Worker dry-run build:

```bash
npm --workspace worker run build
```

For deployment, create a free Cloudflare Worker and set these secret variables in the Cloudflare dashboard or with Wrangler:

```text
YOUTUBE_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
GOTUBE_SYNC_KEY
```

Frontend build:

```bash
npm --workspace apps/web run build
```

Cloudflare Pages can host `apps/web/dist`. Set `VITE_API_BASE_URL` to the deployed Worker `/api` origin if the Worker is not served from the same domain.

If Cloudflare asks for paid features, billing, or a card, stop and keep the step manual.

## Testing

Fast checks:

```bash
npm run typecheck
npm run build
```

Manual Brave testing on localhost:

1. Open `http://127.0.0.1:5173/`.
2. Confirm the app loads.
3. Open Settings and save your `GOTUBE_SYNC_KEY`.
4. Confirm Backend Status is healthy.
5. Search for a real channel or video. For exact channel adds, try a channel URL, channel ID, or handle such as `@GoogleDevelopers`.
6. Add a channel and confirm it syncs real uploads.
7. Confirm Feed is reverse chronological and initially shows the latest 20 synced videos.
8. Use Load Older to append the next page of older synced videos.
9. Remove the channel from Channels and confirm it leaves the feed; re-add it to confirm follow/unfollow behavior.
10. Add a video to Watch Later, then remove it.
11. Mark a video watched and confirm it hides when hide watched is enabled.
12. Confirm Shorts are hidden by default.
13. Open `http://127.0.0.1:5173/tv`.
14. Use arrow keys and Enter to move through Feed, Watch Later, Search, Channels, and Load Older.

No recommendations, Trending, Home, Shorts feed, comments, or unrelated discovery surfaces should appear in GoTube UI.

## Fire TV Silk Testing

After deploying the frontend and Worker on free tiers:

1. Open the deployed `/tv` URL in Fire TV Silk.
2. Enter the private sync key in the standard UI first, or use the same browser storage/session if available.
3. Verify large cards, visible focus rings, arrow-key navigation, Enter selection, Escape/Backspace back behavior, and Space play/pause.

The `/tv` route is structured so it can later be wrapped in an Android WebView Fire TV app.

## Playback Notes

GoTube embeds only the selected video with the YouTube IFrame Player API using `youtube-nocookie.com`, `rel=0`, `modestbranding=1`, and a GoTube-owned “Back to GoTube” control. GoTube does not render sidebars, recommendations, comments, or autoplay discovery UI.

YouTube may still control parts of the embedded player experience. GoTube minimizes recommendation leakage within the options YouTube provides and does not attempt to bypass YouTube terms.
