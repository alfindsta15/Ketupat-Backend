# KETUPAT Backend (Cloudflare Workers)

Backend bot WhatsApp KETUPAT: **Hono + TypeScript** di **Cloudflare Workers**, database **Neon PostgreSQL** lewat Prisma 7, file upload di **Cloudflare R2**, WhatsApp via **Fonnte**.
Dokumentasi lengkap (arsitektur, deploy, troubleshooting) ada di `README.md` proyek utama; ringkasan operasional ada di bawah.

## Mulai cepat

```bash
npm install                          # otomatis prisma generate
cp .dev.vars.example .dev.vars       # isi DATABASE_URL, JWT_SECRET, FONNTE_TOKEN, SEED_ADMIN_*
npm run seed:admin                   # buat/reset akun admin (PBKDF2)
npm run dev                          # http://localhost:8787  (health: /health)
npm run typecheck && npm test
```

> `DATABASE_URL` Neon: hapus `&channel_binding=require` dari URL.

## Deploy

```bash
npx wrangler login
npx wrangler r2 bucket create ketupat-uploads
# edit [vars] di wrangler.toml (FRONTEND_URL wajib diganti dengan domain Vercel)
npx wrangler secret put DATABASE_URL
npx wrangler secret put JWT_SECRET             # openssl rand -hex 32
npx wrangler secret put FONNTE_TOKEN
npx wrangler secret put FONNTE_WEBHOOK_SECRET  # openssl rand -hex 24
npm run deploy
```

Lalu:
1. Cek `https://ketupat-api.<akun>.workers.dev/health`.
2. Jalankan `npm run seed:admin` (hash password format baru).
3. Webhook Fonnte: `https://ketupat-api.<akun>.workers.dev/webhook/fonnte?secret=<FONNTE_WEBHOOK_SECRET>` (Auto Read ON).
4. Upload ulang QRIS di dashboard → Settings.
5. Matikan service lama di Back4app.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Worker lokal (`wrangler dev`), R2 disimulasikan |
| `npm run deploy` | `prisma generate` + `wrangler deploy` |
| `npm run seed:admin` | Buat/perbarui admin dari `.dev.vars` |
| `npm run prisma:deploy` | Terapkan migrasi ke database |
| `npm run typecheck` / `npm test` | Cek tipe / unit test |
| `npx wrangler tail` | Log produksi langsung |

## Struktur

```
src/worker.ts      entry point (env, koneksi DB per request)
src/app.ts         Hono: CORS, /health, /uploads dari R2, /webhook, /api
src/routes|controllers|services|middleware|bot|utils|lib
prisma/            schema, migrations, seed
wrangler.toml      konfigurasi Worker + R2 (+ Hyperdrive opsional)
```

Jangan commit `.dev.vars` / `.env`. Rahasia produksi hanya lewat `wrangler secret put`.
