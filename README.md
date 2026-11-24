# nas-wapi

REST API untuk WhatsApp Web dengan dukungan webhook.

## Fitur

- Autentikasi Bearer token
- Kirim pesan ke grup/individual (teks, gambar, dokumen)
- Jadwal pengiriman pesan
- Webhook untuk pesan masuk
- Rate limiting & compression
- SQLite database (zero config)

## Quick Start

```bash
# Install dependencies from the lockfile
pnpm install --frozen-lockfile

# Copy environment config, then configure API_KEY and CHROMIUM_PATH
cp .env.example .env

# Run
pnpm start
```

Gunakan `pnpm dev` untuk development, `pnpm lint` untuk lint, dan `pnpm test` untuk menjalankan test.

## Konfigurasi

Edit `.env` sesuai kebutuhan:

```env
API_KEY=your_api_key
HOST_PORT=3030
WEBHOOK_URL=https://your-webhook.com/endpoint

# SQLite (opsional, default: ./data/whatsapp_api.db)
SQLITE_PATH=./data/whatsapp_api.db
```

Secara default header `X-Forwarded-*` tidak dipercaya. Jika aplikasi berada di belakang reverse proxy, set `TRUSTED_PROXIES` ke alamat IP/CIDR proxy yang dikontrol, dipisahkan koma; jangan izinkan akses langsung yang melewati proxy. Pengaturan ini diperlukan agar rate limit menggunakan alamat klien yang benar.

## Requirements

- Node.js `^22.19.0 || ^24.0.0 || >=26.0.0`; gunakan Node.js 24 LTS jika memungkinkan. Node.js 18 dan 20 tidak lagi didukung oleh dependensi terbaru.
- pnpm 12.16.1; `pnpm-lock.yaml` adalah lockfile yang digunakan untuk instalasi reproducible.
- Chrome/Chromium yang kompatibel dengan Puppeteer, dikonfigurasi melalui `CHROMIUM_PATH` di `.env`. Script instalasi Puppeteer dinonaktifkan; browser tidak diunduh otomatis.
- Redis hanya diperlukan jika `QUEUE_CONNECTION=redis`; Bull menggunakan klien Redis bawaannya.

Paket `better-sqlite3` menggunakan binary bawaan untuk platform yang didukung. Lifecycle scripts dependensi dibatasi di `pnpm-workspace.yaml`; platform tanpa binary bawaan memerlukan build native sesuai [panduan better-sqlite3](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/compilation.md).

## Upgrade dari versi sebelumnya

1. Backup database SQLite dan direktori sesi `.wwebjs_auth` sebelum deployment. Jangan menyalin keduanya ke repository.
2. Upgrade Node.js dan pnpm, lalu jalankan `pnpm install --frozen-lockfile`.
3. Pastikan `CHROMIUM_PATH` menunjuk ke browser yang terpasang, dan verifikasi `/health` serta pengiriman pesan pada lingkungan staging.

Versi SQLite yang dibawa `better-sqlite3` berubah saat upgrade; verifikasi kompatibilitas data dan rencana rollback sebelum deployment.

## Dokumentasi

Lihat [Wiki](https://github.com/NasroelLah/wwebjs_api/wiki/How-To) untuk panduan lengkap.
