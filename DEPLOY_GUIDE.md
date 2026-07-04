# Deploying javid-dol.uk (Cloudflare Pages)

Domain is already registered in Cloudflare, nothing has been pushed yet, and a GitHub account exists. This is the fastest path: push this folder to a new GitHub repo, connect it to Cloudflare Pages, attach the domain.

**Before you start:** delete the empty `Landing_Page\.git` folder if one exists here (a leftover from testing) — just delete the `.git` folder itself, not any other files, then continue.

## 1. Push this folder to a new GitHub repo

Open a terminal in this folder (`Landing_Page`) and run:

```
git init
git add .
git commit -m "Initial landing page"
git branch -M main
```

Go to github.com/new and create a **new, separate** repository (do NOT reuse the `javid_future_bot_V18_0` repo — that one holds the bot's source and stays private):
- Name: `javid-dol-landing` (or anything you like)
- Visibility: **Public** (Cloudflare Pages needs to read it, and there's no source code in this folder — just the site and the already-built download zips)
- Do not check "Add a README"

Then:

```
git remote add origin https://github.com/<your-username>/javid-dol-landing.git
git push -u origin main
```

## 2. Connect Cloudflare Pages to that repo

1. dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** tab → **Connect to Git**
2. Authorize GitHub if asked, select `javid-dol-landing`
3. Build settings:
   - Framework preset: **None**
   - Build command: *(leave blank)*
   - Build output directory: `/`
4. **Save and Deploy** — takes about 30–60 seconds. You'll get a working `*.pages.dev` URL first; open it and click around before attaching the real domain.

## 3. Attach javid-dol.uk

In the new Pages project → **Custom domains** tab → **Set up a custom domain** → enter `javid-dol.uk` → **Activate domain**.

Since the domain's DNS is already in this same Cloudflare account, this step is usually automatic (no manual CNAME editing needed). SSL certificate issuance takes a few minutes. Optionally repeat for `www.javid-dol.uk` if you want that to also resolve.

## 4. Verify

Visit `https://javid-dol.uk` — should load the real site. Click through: Live Results, User Manual, Binance Setup Guide, and both download buttons.

## Future updates

Any time you change a file in this folder:

```
git add .
git commit -m "update"
git push
```

Cloudflare Pages redeploys automatically within about a minute — no dashboard steps needed after the first setup.
