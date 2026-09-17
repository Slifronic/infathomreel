# InfathomReel

DM a Reel to `@infathomreel.ai` and get back an analysis: true/false verdict, what's
questionable, what resources it points to, and what the video is actually trying
to say.

## How it works

1. Someone shares a Reel to `@infathomreel.ai`'s Instagram DMs.
2. Meta POSTs the message event to `/api/webhook` (this app).
3. The webhook acks immediately, then in the background:
   - downloads the video from the CDN URL in the message payload
   - sends it to a video-capable model (via Vercel AI Gateway) for structured analysis
   - replies in the same DM thread with the result

No copy-pasting links, no manual triggering — sharing the Reel *is* the trigger.

## One-time setup (do this before deploying)

### 1. Convert the secondary account to Creator

Instagram's Messaging API only exposes DMs sent to **Business or Creator**
accounts — personal accounts aren't visible to the API at all.

In the `@infathomreel.ai` account: Settings → Account type and tools → Switch to
Professional Account → Creator.

### 2. Create a Meta app

- Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) → Create App → type "Other" → "Business".
- In the app dashboard, add the **Instagram** product (look for "Instagram API
  with Instagram Login" — this is the current path that doesn't require
  linking a Facebook Page).

### 3. Add `@infathomreel.ai` as a tester on your own app

Since this is just for your own account, you don't need Meta's full App
Review — adding the account as a role on your app is enough:

- App dashboard → App roles → Roles → add `@infathomreel.ai` as an **Instagram Tester**.
- Log into `@infathomreel.ai` on Instagram → Settings → Apps and websites → Tester
  invites → **accept** the invite from your app.

### 4. Generate a long-lived access token

- In the app's Instagram product settings, use the "Generate token" flow for
  Instagram Login, authenticating as `@infathomreel.ai`.
- Required scopes: `instagram_business_basic`, `instagram_business_manage_messages`
  (exact scope names occasionally shift — the token generation UI will list
  what's currently required).
- Exchange the short-lived token it gives you for a long-lived one (60 days,
  refreshable) via the `/access_token` refresh endpoint documented on the same
  page. Put the long-lived token in `IG_PAGE_ACCESS_TOKEN`.

### 5. Deploy this app to Vercel first

You need a live URL before Meta will let you save a webhook subscription.

```bash
vercel deploy
```

Then set the env vars from `.env.example` in the Vercel project settings
(`IG_APP_SECRET`, `IG_VERIFY_TOKEN` — make this one up yourself — and
`IG_PAGE_ACCESS_TOKEN`), and redeploy so they take effect.

### 6. Configure the webhook

Back in the Meta app's Instagram product → Webhooks:

- Callback URL: `https://<your-vercel-domain>/api/webhook`
- Verify token: the same string you put in `IG_VERIFY_TOKEN`
- Subscribe to the **`messages`** field

Meta will hit the callback URL with a GET request to confirm you control it —
this app's `GET /api/webhook` handles that automatically.

### 7. Test it

DM any Reel to `@infathomreel.ai` from a normal account. You should get an
acknowledgment message within a second or two, then the full analysis
shortly after.

## Notes / limitations

- **Anyone** who DMs a Reel to the account gets analyzed — there's no sender
  allowlist. Add one in `app/api/webhook/route.ts` if you want to restrict it.
- Instagram DMs cap out around 1000 characters; long analyses are split across
  multiple messages automatically (`chunkMessage` in `lib/instagram.ts`).
- The attachment `type` Meta sends for a shared Reel isn't perfectly
  documented and has shifted across API versions — check your Vercel function
  logs on the first real test and adjust `REEL_ATTACHMENT_TYPES` in
  `app/api/webhook/route.ts` if nothing fires.
- `ANALYSIS_MODEL` must support video input. `gemini-3.6-flash` (the default,
  called directly via `@ai-sdk/google` — not Vercel AI Gateway, which requires
  a card on file even for free-tier usage) does; swap it if you want a
  different model.
- Requires a `GOOGLE_GENERATIVE_AI_API_KEY` from
  [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free,
  no card, but rate-limited (fine for personal use, not for real traffic).
