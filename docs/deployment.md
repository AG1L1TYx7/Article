# Deploying to your own server

Written for a fresh Ubuntu 22.04/24.04 VPS or dedicated server with root
SSH. Not for shared or cPanel hosting: this is a Node process that has to
stay running, not files you upload.

Roughly 45 minutes end to end, most of it waiting for builds.

---

## What you need first

| | |
| --- | --- |
| A server | 2GB RAM minimum. The build is the hungry part; 1GB will fail it. |
| A domain | With an `A` record already pointing at the server's IP. Check with `dig +short yourdomain.com` before starting — TLS will fail if DNS hasn't propagated. |
| An email address | For Let's Encrypt expiry warnings. |

And three accounts, covered in [step 7](#7-the-three-things-that-must-not-stay-on-fallbacks). The site will start without them; it will not work properly.

---

## 1. Lock the server down first

Do this before the app exists, not after.

```bash
# A user that isn't root
adduser deploy
usermod -aG sudo deploy

# Copy your SSH key across, then log in as deploy and confirm it works
# BEFORE the next step, or you will lock yourself out.
ssh-copy-id deploy@your-server-ip
```

Then disable password logins — this alone removes essentially all of the
automated SSH attacks you would otherwise see in the logs:

```bash
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

Firewall — only SSH and web:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

Note what is *not* opened: 5432. The database is reachable only from the
other containers. An exposed Postgres port is among the most reliably
scanned things on the internet.

---

## 2. Install Docker and nginx

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy   # log out and back in for this to apply

sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

---

## 3. Get the code

```bash
sudo mkdir -p /srv/news-platform
sudo chown deploy:deploy /srv/news-platform
git clone https://github.com/AG1L1TYx7/Article.git /srv/news-platform
cd /srv/news-platform
```

---

## 4. Write the production .env

This file never goes in git. Create it directly on the server:

```bash
nano /srv/news-platform/.env
```

```bash
# --- database -------------------------------------------------------
POSTGRES_USER=news
POSTGRES_PASSWORD=<a long random password, generated below>
POSTGRES_DB=news_platform
# "db" is the service name in docker-compose.yml, not a hostname you
# need to create.
DATABASE_URL=postgresql://news:<same password>@db:5432/news_platform?schema=public

# --- app ------------------------------------------------------------
# Generate with: openssl rand -base64 32
# Never reuse the development one. This also encrypts stored MFA secrets,
# so changing it later invalidates every enrolled authenticator.
AUTH_SECRET=<32 random bytes>
NEXTAUTH_URL=https://yourdomain.com
```

Generate the two secrets:

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -base64 24   # POSTGRES_PASSWORD
```

Lock the file down — it holds every credential the site has:

```bash
chmod 600 /srv/news-platform/.env
```

---

## 5. Start it

```bash
cd /srv/news-platform
docker compose up -d --build
```

The first build takes several minutes. Migrations run automatically as
their own step, so two app containers can never race each other through
the same migration.

Then the two one-off setup commands:

```bash
# Starter categories. Without these the editor's category dropdown is
# empty and the site header has no sections.
docker compose run --rm migrate npm run seed

# Your admin account. Registration always creates a READER — there is no
# "first user becomes admin" path, because that is a privilege escalation
# race on any publicly reachable install.
docker compose run --rm migrate npm run bootstrap:staff -- \
  --email you@yourdomain.com --role ADMIN
```

That prints a generated password **once**. Save it now.

Check it is alive:

```bash
curl -I http://127.0.0.1:3000
docker compose logs -f app
```

---

## 6. nginx and HTTPS

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/news-platform
sudo nano /etc/nginx/sites-available/news-platform   # replace example.com
sudo ln -s /etc/nginx/sites-available/news-platform /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

certbot installs a renewal timer by itself. Confirm it:

```bash
sudo certbot renew --dry-run
```

> **Read the long comment in `deploy/nginx.conf.example` about
> `X-Forwarded-For`.** Using the snippet every other guide gives you makes
> every rate limit in this application trivially bypassable. It is the one
> place in this setup where copying a tutorial actively breaks security.

Now open `https://yourdomain.com`, log in with the admin account, and
enrol MFA — admins cannot reach the rest of the dashboard until they do.

---

## 7. The three things that must not stay on fallbacks

The app runs without these. It does not *work* without them.

### Email — otherwise nobody can verify an address or reset a password

Without `RESEND_API_KEY`, every message is written to a log file on the
server and no human ever receives it. Account recovery is impossible.

Sign up at [resend.com](https://resend.com), verify your domain, then add
to `.env`:

```bash
RESEND_API_KEY=...
EMAIL_FROM="Your Site <no-reply@yourdomain.com>"
```

### Object storage — otherwise images vanish on every redeploy

The compose file mounts a volume so uploads survive a restart, but that is
a patch, not a solution: the files live on one machine, are not backed up
with the database, and don't survive rebuilding the server.

Cloudflare R2 is the cheapest sensible option (S3-compatible, no egress
charges, which matters when serving images):

```bash
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=your-bucket
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
MEDIA_PUBLIC_BASE_URL=https://media.yourdomain.com
```

> **The `quarantine/` prefix must not be publicly readable.** Once object
> storage is configured, the browser uploads large files straight to a
> pre-signed URL under that prefix, and the server fetches them back to
> identify, re-encode and scan them before anything servable exists.
> Objects there are unvalidated and unscanned by definition. If your bucket
> policy makes everything public, that quarantine is decorative.
>
> Make the public read rule apply to the bucket root only, not to
> `quarantine/*`. A lifecycle rule deleting objects under that prefix after
> a day is worth adding too — the app deletes them after processing, but
> an abandoned upload leaves one behind.

### Malware scanning — otherwise video is refused

Video cannot be re-encoded the way sharp re-encodes an image, so scanning
is the whole of its defence. Without it, video uploads are **rejected**
with a 503 explaining why. Images are unaffected.

`docker-compose.yml` already ships a ClamAV service. Point the app at it:

```bash
CLAMAV_HOST=clamav
CLAMAV_PORT=3310
```

It downloads a ~250MB signature database on first start and refreshes it
daily, so allow a few minutes before the first upload. Check it is ready:

```bash
docker compose logs clamav | tail -20
```

The scanner fails closed everywhere: an unreachable or confused daemon
refuses the upload rather than letting it through. If uploads start
returning 503, clamav is down — that is the intended behaviour, not a bug.

### Rate limiting — only if you run more than one instance

On a single server the in-process limiter is correct. The moment there are
two app containers, each keeps its own counters and every documented limit
doubles. Add [Upstash](https://upstash.com) before scaling out:

```bash
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

### Optional: CAPTCHA on registration

```bash
NEXT_PUBLIC_TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...
```

After editing `.env`: `docker compose up -d --force-recreate app`

---

## 8. Backups

On a dedicated server nobody does this for you. Two separate things need
backing up, and having one without the other leaves you with articles
whose images are all broken.

```bash
sudo mkdir -p /srv/backups && sudo chown deploy:deploy /srv/backups
crontab -e
```

```cron
# Database, nightly at 03:00, keeping 14 days.
0 3 * * * cd /srv/news-platform && docker compose exec -T db pg_dump -U news news_platform | gzip > /srv/backups/db-$(date +\%F).sql.gz && find /srv/backups -name 'db-*.sql.gz' -mtime +14 -delete
```

**A backup you have never restored is not a backup.** Test it:

```bash
gunzip -c /srv/backups/db-$(date +%F).sql.gz | head -20   # readable SQL?
```

And get the files off this machine — `rclone` to R2 or B2, or
`scp` on a schedule. A backup that only exists on the server it protects
is not one.

If you are not using S3, the uploads volume needs backing up too:

```bash
docker run --rm -v news-platform_uploads:/data -v /srv/backups:/backup \
  busybox tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

---

## 9. Updating

```bash
cd /srv/news-platform
git pull
docker compose up -d --build
```

Migrations apply automatically. Take a backup first if the update includes
one — `git log --stat` will show whether `prisma/migrations/` changed.

---

## Troubleshooting

**Build killed / exits with 137** — out of memory. Add swap:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**502 Bad Gateway** — the app isn't running. `docker compose logs app`.

**Login redirects back to the login page** — `NEXTAUTH_URL` doesn't match
the address you're visiting. It must be the exact public origin, `https://`
included.

**Uploads fail at a certain size** — `client_max_body_size` in nginx.

**Everyone appears to have the same IP in the audit log** — the
`X-Forwarded-For` problem described in the nginx config. Rate limiting is
not working until this is fixed.

---

## What is still not production-ready

Honest list, so nothing here is a surprise later:

- **Video uploads are accepted but never served.** There is no transcoding
  or malware scanning, so video stays `scanStatus: PENDING` forever and the
  media route refuses to serve it. Wiring up a real pipeline is a
  prerequisite for enabling video, not a nicety.
- **Google OAuth is not scaffolded.** Email and password only.
- **Search has no GIN index.** Fine into the low tens of thousands of
  articles; [`search.md`](search.md) has the migration for when it isn't.
- **One server means one point of failure.** Fine for launch. Scaling out
  needs Upstash first, and S3 rather than the uploads volume.
