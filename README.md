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
# Install dependencies
bun install

# Copy environment config
cp .env.example .env

# Run
bun start
```

## Konfigurasi

Edit `.env` sesuai kebutuhan:

```env
API_KEY=your_api_key
HOST_PORT=3030
WEBHOOK_URL=https://your-webhook.com/endpoint

# SQLite (opsional, default: ./data/whatsapp_api.db)
SQLITE_PATH=./data/whatsapp_api.db
```

## Requirements

- Node.js >= 18 atau Bun
- Chrome/Chromium (untuk Puppeteer)

## Dokumentasi

Lihat [Wiki](https://github.com/NasroelLah/wwebjs_api/wiki/How-To) untuk panduan lengkap.
