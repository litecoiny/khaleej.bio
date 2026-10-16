# khaleej.bio

A bio-link profile builder: people claim a name, design their page in the dashboard (avatar, badges, links, socials, music, backgrounds, effects) and share `khaleej.bio/<name>`.

The front end is plain HTML, CSS and JavaScript. `server.js` is a small Node server with no dependencies:

- **Accounts and sessions**: passwords are hashed with scrypt; sessions are random tokens in an `HttpOnly`, `SameSite=Lax` cookie.
- **Profiles, views and uploads** live in a SQLite database (`node:sqlite`, built into Node) plus an uploads folder, both inside `DATA_DIR` (default `data/`).
- **Public pages** are served at `/<name>`. Every load adds 1 to the view count on the server.
- **The Discord bot** handles Sign in with Discord and live presence (see below).

## Run locally

Requires Node 22.13 or newer. There are no dependencies to install.

```bash
npm run dev
# → http://127.0.0.1:4317
```

Set `PORT=xxxx` to use a different port. Add `DISCORD_MOCK=1` to try Discord sign-in and presence without a Discord app.

Outside production a demo account is created automatically:

- Public page: `http://127.0.0.1:4317/demo`
- Dashboard login: `demo` / `khaleej123`

To start from an empty site, stop the server and delete the `data/` folder.

## Pages

| File | What it is |
| --- | --- |
| `index.html` | Landing page |
| `signup.html`, `login.html`, `discord.html` | Sign up, log in, Sign in with Discord |
| `dashboard.html` | Editor with a live preview of the page |
| `/<name>` (or `u.html?u=<name>`) | The public profile page |

## How data flows

When the server sends a page it injects `window.KG_BOOT` with the signed-in user and, on profile pages, the profile being viewed. `assets/js/auth.js` reads from that, so the front end reads data synchronously. Changes are sent to the API in the background: one request in flight at a time, and the newest state wins.

| Endpoint | What it does |
| --- | --- |
| `POST /api/signup`, `POST /api/login`, `POST /api/logout` | Accounts and sessions |
| `GET /api/me`, `PUT /api/me`, `DELETE /api/me` | Your profile. Images sent as `data:` URLs are saved as files under `/media/<uid>/` |
| `POST /api/account`, `POST /api/password` | Change username, email or password |
| `GET /api/username/:name` | Is a name free? |
| `GET /api/users/:name` | A public profile (no email) |
| `PUT /api/blob/audio`, `PUT /api/blob/bgvideo` | Upload a track (50 MB) or background video (100 MB) |

Requests that change something must send the header `X-KG: 1`. Because of that header, other sites can't send these requests on a visitor's behalf (CSRF protection). Login and signup are rate-limited per IP. Only the pages, `/assets/` and `/media/` are served; `.env`, `data/`, `server/` and `.git` never are.

## How the profile renders

`assets/js/profile-render.js` builds the profile markup, and `assets/css/profile.css` styles it. The dashboard preview and the public page use the same renderer and the same stylesheet. Layouts respond to the width of the profile container (CSS container queries) rather than the window, which is why the preview matches what visitors see at that width.

The entrance animation (the card settles in, then the avatar, name, badges, bio, socials, links and player follow in sequence) is `KG.animateProfile()`. On the public page it plays once the visitor gets past the splash screen. In the dashboard it plays when you open a panel, and the replay button in the preview bar plays it again.

## Look & feel options

- **Layouts**: Glass (the default: a centred frosted-glass card with a large glowing avatar, a gradient name with twinkling sparkles, a badge pill, typewriter bio, location and join date, Discord presence card, glowing socials, two-column links and a view counter), Card (a wide black profile card with the avatar beside your name, a badge pill, join date, Discord presence card, glowing socials and a view counter), Classic, Big, Spread, Wide, Left and Minimal.
- **Icon glow**: Off, White, Accent or Rainbow. Social icons, badges and link icons always have drop shadows. Glow adds a bloom on top.
- **Font**: Default, Pixel, Mono or Serif.
- **Background effects**: Nebula (the default: slow-drifting colour clouds tinted by your accent, with stars, film grain and a vignette), Stars (twinkling sparkles), Aurora, Grain, Particles, Rain, Snow and Plasma.
- **3D tilt on hover** (Appearance → Effects, on by default): the card leans toward the mouse. Turn it off for a flat card.
- **Socials: Link or Copy**: each social in Links & socials has a Link / Copy switch. Copy makes the icon copy the username to the visitor's clipboard instead of opening a page. Discord uses Copy by default.
- **Volume button**: pages with music get a volume button in the top-left corner. Click to mute, hover to show a slider. The level is remembered per visitor.
- **View counter**: every time the page is opened, the server adds 1. Browser prefetches don't count. The dashboard graph shows the last 30 days.
- The whole site uses a black and white palette. Your page's accent colour is white by default, and you can change it in the dashboard.
- The preview bar switches between a desktop view (rendered at desktop width, then scaled down) and a mobile view.

## Media

- **Background video (mp4 / webm)**: free on every plan. You can upload a file up to 100 MB or paste a direct link.
- **Audio**: upload an mp3 or mp4 up to 50 MB, or paste a direct link. Only the sound plays on the page. The player look can be Music player, Volume, or Hidden. Hidden plays the music with nothing on screen, so pair it with the splash screen so playback can start when someone enters.

## Discord presence

The Discord widget shows live presence: avatar, online / idle / do-not-disturb / offline, custom status, the game you're playing with elapsed time, and Spotify with album art and a progress bar. It updates live without reloading.

### Linking with the khaleej.bio bot (recommended)

People click **Link Discord** in the dashboard (Appearance → About, skills & widgets → Discord widget, or Settings → Connections). They sign in with Discord, and the bot adds them to your server, because a bot can only see presence for people in a server it's in. Then they land back in the dashboard already linked. The bot (`server/discord.js`) keeps a gateway connection open and streams presence changes to profile pages over server-sent events. It only exposes accounts that have linked.

One-time setup:

1. Create an application at <https://discord.com/developers/applications>.
2. **OAuth2**: copy the Client ID and Client Secret, and add the redirect `PUBLIC_URL/auth/discord/callback` (locally `http://127.0.0.1:4317/auth/discord/callback`).
3. **Bot**: reset and copy the token, then turn on the **Server Members** and **Presence** privileged intents.
4. Invite the bot to your server with the "Create Invite" permission (needed to add linked users):
   `https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot&permissions=1`
5. Copy the server ID (Developer Mode → right-click the server → Copy Server ID).
6. `cp .env.example .env`, fill in the values, then `npm run dev`.

| Variable | What it is |
| --- | --- |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | OAuth2 credentials |
| `DISCORD_BOT_TOKEN` | The bot's token |
| `DISCORD_GUILD_ID` | The server the bot is in, where linked users are added |
| `PUBLIC_URL` | Where the site is reachable, used for the OAuth redirect |
| `DISCORD_MOCK=1` | Try the whole flow locally without any keys (a simulated account whose status changes every 15 seconds) |

Linked accounts are stored in `DATA_DIR/discord-linked.json`.

The same app powers **Sign in with Discord** (`/auth/discord/login`, scopes `identify email guilds.join`). It logs into the account tied to that Discord user, or creates one with the presence widget already linked.

Endpoints: `GET /auth/discord/login`, `GET /auth/discord`, `GET /auth/discord/callback`, `GET /api/discord/config`, `GET /api/presence/:id`, `GET /api/presence/:id/stream`. The presence response uses the same shape as Lanyard.

### Without the bot: Lanyard

If the bot isn't set up, or the site is hosted as plain static files, the dashboard offers [Lanyard](https://github.com/Phineas/lanyard) instead: join <https://discord.gg/lanyard> once, then paste your Discord user ID. Profile pages use the bot when it's available and fall back to Lanyard otherwise.

Once connected, "Use Discord as profile picture" shows your Discord avatar with a live status dot as your page's profile picture. If you never upload a picture, it's used automatically.

## Launching

### 1. Domain

Buy `khaleej.bio` from a registrar such as Porkbun, Namecheap or Cloudflare.

### 2. Host

The site needs a host that keeps a Node process running, for the Discord bot, and has a **persistent disk** for `DATA_DIR`. Static hosts such as Netlify, Vercel or GitHub Pages won't work.

**Railway** (easiest)
1. Push this repo to GitHub and create a new Railway project from it. Railway detects the `Dockerfile`.
2. Add a **Volume** mounted at `/data`.
3. Under Variables, set `PUBLIC_URL=https://khaleej.bio` and the Discord values from the table below.
4. Under Settings → Networking, add the custom domain `khaleej.bio`, then create the DNS record Railway shows you at your registrar.

**Render**
1. Create a new **Web Service** from the repo with the Docker runtime and a paid instance type (a disk needs one).
2. Add a **Disk** mounted at `/data`.
3. Set the same variables as for Railway.
4. Add the custom domain and the DNS record Render shows you.

**A VPS** (Hetzner, DigitalOcean, …)
```bash
# Install Node 22, then:
git clone <your repo> khaleej && cd khaleej
cp .env.example .env    # set PUBLIC_URL=https://khaleej.bio, NODE_ENV=production, TRUST_PROXY=1, DATA_DIR=/var/lib/khaleej
npm i -g pm2 && pm2 start npm --name khaleej -- start && pm2 save && pm2 startup
```
Put [Caddy](https://caddyserver.com) in front of it for automatic HTTPS. The whole `/etc/caddy/Caddyfile` is:
```
khaleej.bio {
  reverse_proxy 127.0.0.1:4317
}
```
Then point an `A` record for `khaleej.bio` at the server's IP.

### 3. Production variables

| Variable | Value |
| --- | --- |
| `PUBLIC_URL` | `https://khaleej.bio`. It must be https, which also turns on secure cookies |
| `NODE_ENV` | `production` (the Dockerfile sets it). This turns off the demo account |
| `DATA_DIR` | The persistent disk (`/data` in Docker) |
| `TRUST_PROXY` | `1` behind Railway, Render, Caddy or nginx (the Dockerfile sets it) |
| `DISCORD_*` | From the Discord setup above. Don't set `DISCORD_MOCK` |

In the Discord developer portal, change the OAuth2 redirect to `https://khaleej.bio/auth/discord/callback`.

### 4. Before you announce it

- Sign up, edit your page, then open `khaleej.bio/<you>` from your phone on mobile data to check that it loads for other people.
- Back up `DATA_DIR`. It holds every account and upload.
- Add Terms and Privacy pages; the signup form already asks people to accept them.
- There's no "forgot password" email yet. People who linked Discord can still sign in with Discord.
