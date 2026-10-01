# Connecting every network: what each platform needs

The platform can now connect **LinkedIn (personal)**, **LinkedIn Company Pages**, **Facebook Pages**,
**Instagram**, **YouTube**, **TikTok** and **X** to a brand. Each network only works once
Colaberry has a developer app registered with that platform, the same way LinkedIn needed app
`86e3lkpm791ybb`. Creating those apps needs a person's login and the business's identity, so
this document is the checklist for doing it.

**Connecting is not the same as posting.** A connected account stores the sign-in securely and
shows up on the Overview and the Brands page. Posts to that network are still **handed off**:
the platform prepares the exact post and a person publishes it. That continues until the
network's publishing adapter is built and switched on in `LIVE_CONNECTORS`. As of 2026-09-18,
direct posting is BUILT for LinkedIn personal profiles (live in production), LinkedIn Company
Pages, Facebook Pages and Instagram; it is switched ON only for `linkedin_member`. YouTube, TikTok
and X connect but still hand off. The Overview's "Posted by hand" line always shows which
networks are still handoff.

All times Central.

---

## Before any of them: the redirect URLs

Every platform asks for an **authorized redirect URL**. It must match character for character:
no trailing slash, and `https`. These are the exact values:

| Network | Redirect URL to register |
|---|---|
| LinkedIn Company Page | `https://www.refactored.ai/api/marketing/oauth/linkedin_org/callback` |
| Facebook & Instagram | `https://www.refactored.ai/api/marketing/oauth/meta/callback` |
| YouTube | `https://www.refactored.ai/api/marketing/oauth/youtube/callback` |
| TikTok | `https://www.refactored.ai/api/marketing/oauth/tiktok/callback` |
| X | `https://www.refactored.ai/api/marketing/oauth/x/callback` |

The Brands page shows the same URL under each network's **What it needs**. Copy it from there
if in doubt; it is computed by the server, so it cannot drift from what the server expects.

**Do the connecting on `www.refactored.ai`**, not `enterprise.colaberry.ai`. The networks send
the browser back to refactored.ai, and sign-ins are per host.

## Getting the credentials onto the server

Each network produces an ID and a secret. Either:

- put them in a text file in your Downloads folder and tell Claude the file name (the LinkedIn
  pattern), or
- SSH to `root@95.216.199.47` and add them to the backend env file yourself (the same file that
  holds `SOCIAL_CREDENTIAL_MASTER_KEY`), then restart the backend.

Never paste a secret into Basecamp, email, chat or a screenshot. After the restart, the Brands
page's **Connect a network** list shows the network as **Ready to connect**.

---

## LinkedIn Company Page

**Why a second LinkedIn app:** posting as a Company Page needs LinkedIn's **Community Management
API**. LinkedIn only accepts that request on a **new app that has no other products**, so the
existing app (which also serves a Bubble app) cannot be reused and must not be touched.

1. https://www.linkedin.com/developers/apps → **Create app**, associated with the Colaberry
   Company Page.
2. **Products** tab → request **Community Management API**. This is vetted; LinkedIn grants the
   *Development* tier first (500 calls per app per day), then *Standard* after a screencast review.
3. **Auth** tab → add the redirect URL above. Copy the Client ID and Primary Client Secret.
4. Server variables: `LINKEDIN_ORG_CLIENT_ID`, `LINKEDIN_ORG_CLIENT_SECRET`.
5. The person connecting must be a **Super admin** or **Content admin** of the Company Page.
6. To post directly once connected, add `linkedin_organization` to `LIVE_CONNECTORS`
   (currently `linkedin_member`), then restart.

## Facebook Pages and Instagram (one Meta app covers both)

**Walked end to end on 2026-09-30 and corrected against what the console actually does.** The
previous version of this section was written from documentation and was wrong in five places;
each is called out below as a trap, because every one of them costs twenty minutes.

### 1. Create the app

https://developers.facebook.com/apps -> **Create app**. The wizard is App details -> Use cases
-> Business -> Requirements -> Overview.

- On **Use cases**, the option you want is **Other**, and it is NOT in the Featured six. Click
  the **Others** filter on the left to find it. Picking a featured use case makes Meta wire up
  its own permission set and login configuration, which you then have to work around.
- On **Business**, "No businesses available" is FINE. Click Next. A verified business portfolio
  is only needed for App Review, which this setup does not require - see step 6.
- "No requirements identified" on the Requirements step is expected.

Leave the app **Unpublished**. That is the steady state, not a stopgap.

### 2. Add the two use cases

Dashboard -> **Add use cases** -> filter **Content management**, and tick BOTH:

- **Manage everything on your Page** -> `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`
- **Manage messaging & content on Instagram** -> the Instagram permissions, via step 3

**TRAP: permissions come from the USE CASES, not from the login configuration.** The
configuration can only offer permissions the app has already been granted. Create it first and
its dropdown offers two, which looks broken and is not.

Adding these also installs **Facebook Login for Business** in the left nav. There is no
"Add product" menu in this console; that is how the product arrives.

### 3. Point Instagram at the FACEBOOK login path

Opening the Instagram use case lands you on **API setup with Instagram login**. That is the
wrong path for us: it has its own app id and secret and uses `instagram_business_*` permissions,
none of which this platform calls.

In the left sub-nav click **API setup with Facebook login**, then **Add required content
permissions**. That grants `instagram_basic` and `instagram_content_publish`.

Do NOT click **Add required messaging permissions** - it adds `instagram_manage_messages` for
DMs, which nothing here uses.

**TRAP: the Instagram app secret shown on that screen is not the one you need.** `META_APP_SECRET`
is the main app's secret, from App settings -> Basic.

### 4. Register the redirect URI in the right field

**TRAP, and the expensive one.** App settings -> Advanced -> App authentication -> **Authorize
callback URL** is NOT the field Facebook Login for Business reads. Putting the URL only there
leaves the sign-in failing with an unhelpful error.

The field that matters: **Facebook Login for Business -> Settings -> Valid OAuth Redirect URIs**.

- It is a chip input. Paste, then press **Enter** so it becomes a tag, then **Save changes** at
  the bottom of the page, then reload and confirm it survived.
- Same page, **Redirect URI Validator**: paste the URL and press **Check URI**. It tells you what
  Meta will actually accept. Use it - it is free proof, and "invalid redirect URI" here means the
  save did not take.
- Confirm **Client OAuth login**, **Web OAuth login** and **Use Strict Mode** are all Yes.

### 5. Create the login configuration

**Facebook Login for Business -> Configurations -> Create configuration.**

- **Access token type: User access token.** Not System user. A system-user token skips the
  operator's own Page choice entirely, so nothing useful connects and no error explains why.
  The confirmation you chose correctly is Meta telling you *"You can't select assets because you
  chose to use a user access token"*.
- Permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
  `instagram_basic`, `instagram_content_publish`, and `business_management` if offered.

Copy the **Configuration ID**. It becomes `META_LOGIN_CONFIG_ID`.

### 6. App roles decide who can connect

**App roles -> Add People -> Administrator or Tester.** Until Meta grants Advanced Access
(App Review plus Business Verification), only people with a role on the app can complete the
sign-in, and only for Pages they administer.

For Colaberry posting to its own Pages that is permanent, not temporary. App Review is needed
only to let people WITHOUT a role connect their own Pages.

### 7. Server variables

```
META_APP_ID            # App settings -> Basic
META_APP_SECRET        # App settings -> Basic -> Show (the MAIN app, not Instagram's)
META_LOGIN_CONFIG_ID   # from step 5
META_GRAPH_VERSION     # optional; match the app's version, e.g. v26.0
```

They live in `/opt/colaberry-accelerator/.env` and are read at call time, so activation is "set
them, restart the backend". The redirect base URL is `MARKETING_OAUTH_BASE_URL` when set,
otherwise the origin of `LINKEDIN_REDIRECT_URI` - one fact, not two to keep in step.

### 8. Connect, and check it actually worked

Brands -> pick the brand -> Channels -> Connect on Facebook & Instagram. Tick the Pages you
want; each one's linked Instagram professional account connects with it.

The check that matters is **`token_expires_at` IS NULL** on the stored credential. Meta's ladder
is short-lived user token -> long-lived user token -> Page token, and only the last never
expires. If you see an expiry a couple of hours out, the ladder was skipped: the account will
read as healthy tonight and fail every post tomorrow morning.

### 9. Switching direct publishing on

Two gates, and BOTH must be satisfied - this is not obvious and cost a round trip on 2026-09-30:

1. `LIVE_CONNECTORS` must name the provider (`meta_facebook_page`, `meta_instagram`).
2. `appReview.status` in `providerCapabilities.ts` must be `approved` or `self_serve`.

Both Meta providers are `self_serve` as of 2026-09-30, verified against the live API rather than
assumed: a real Page post returned HTTP 200 and a post id, and an Instagram media container was
created, both with the app unpublished and no App Review. Standard Access covers app-role users
posting to their own Pages.

What Facebook and Instagram accept: text, one photo, up to 10 photos as a carousel, or one MP4.
Instagram has NO text-only post. Meta FETCHES each attachment from a short-lived signed URL on
`www.refactored.ai`, so that host must stay reachable at publish time.

Limits: Instagram allows 100 API-published posts per account per 24 hours.

## YouTube

1. https://console.cloud.google.com → use the existing Colaberry project (it already holds the
   YouTube API key) or create one.
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **OAuth consent screen** → External; add the scopes `youtube.upload` and `youtube.readonly`;
   while the app is in *Testing*, add every account that will connect as a **test user**.
4. **Credentials → Create credentials → OAuth client ID** → type **Web application** → add the
   YouTube redirect URL above. Copy the Client ID and Client secret.
5. Server variables: `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`.

**The rule that matters:** until the project passes YouTube's API compliance audit, every video
uploaded through the API is **locked to private**. Connecting works at once; public uploads
need the audit, which is applied for from the Google Cloud console.

## TikTok

1. https://developers.tiktok.com → **Manage apps → Connect an app**.
2. Add **Login Kit** (redirect URI: the TikTok URL above) and the **Content Posting API**
   (scopes `user.info.basic`, `video.upload`, `video.publish`).
3. Copy the **Client key** and **Client secret**.
4. Server variables: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`.

**The rule that matters:** until TikTok audits the app, everything it posts is **private**
(visible only to the account owner). Apply for the audit from the developer portal.

## X

1. https://developer.x.com → **Projects & Apps** → create an app.
2. **User authentication settings** → OAuth 2.0 **on**, type **Web App, Automated App or Bot**
   (a confidential client), permissions **Read and write**, callback URL: the X URL above.
3. Copy the **OAuth 2.0 Client ID** and **Client Secret** (not the older API Key and Secret).
4. Server variables: `X_OAUTH_CLIENT_ID`, `X_OAUTH_CLIENT_SECRET`.

**Cost, because X is the only network that charges:** the X API is pay-per-use with prepaid
credits bought in the developer console. As of 2026-09-18: about **$0.015 per post**, and
**$0.20 per post that contains a link**. Marketing posts usually carry a tracked link, so budget
at the $0.20 rate: 60 posts a month is about $12. Connecting costs one account lookup.

---

## After connecting

- The **Brands** page lists the new accounts under the brand, with their status.
- The **Overview → Accounts** panel shows the same accounts. Networks with no direct posting yet
  stay on its "Posted by hand" line.
- Sign-ins do not last forever:
  - LinkedIn personal: 60 days, no renewal. Reconnect before the date shown.
  - Meta Pages: tokens that do not expire.
  - X, YouTube and TikTok: short sign-ins with long-lived renewal keys, so their connections
    stay alive. Renewing is built with each network's publishing adapter.
