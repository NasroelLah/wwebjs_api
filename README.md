# nas-wapi

REST API untuk WhatsApp Web dengan dukungan webhook.

## Fitur

- Autentikasi Bearer token
- Kirim pesan ke grup/individual (teks, gambar, dokumen)
- Jadwal pengiriman pesan (Upstash Redis + Upstash Workflow)
- Dashboard admin `/admin` untuk memantau dan mengoreksi status pesan terjadwal
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

# Upstash (wajib untuk pesan terjadwal)
UPSTASH_REDIS_REST_URL=https://your-db.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_redis_rest_token
QSTASH_TOKEN=your_qstash_token
QSTASH_CURRENT_SIGNING_KEY=your_current_signing_key
QSTASH_NEXT_SIGNING_KEY=your_next_signing_key
# URL publik API ini; QStash memanggil {WORKFLOW_BASE_URL}/api/workflows/*
WORKFLOW_BASE_URL=https://your-public-api.example
```

Secara default header `X-Forwarded-*` tidak dipercaya. Jika aplikasi berada di belakang reverse proxy, set `TRUSTED_PROXIES` ke alamat IP/CIDR proxy yang dikontrol, dipisahkan koma; jangan izinkan akses langsung yang melewati proxy. Pengaturan ini diperlukan agar rate limit menggunakan alamat klien yang benar.

## Pengiriman dan penjadwalan

- Status WhatsApp `READY` menunggu event `ready`; `authenticated` belum berarti client siap mengirim.
- Pesan terjadwal disimpan di Upstash Redis lalu dipicu melalui Upstash Workflow (QStash), yang memanggil `POST {WORKFLOW_BASE_URL}/api/workflows/message`. API hanya melaporkan jadwal diterima setelah penyimpanan Redis dan trigger QStash berhasil; jika trigger gagal, pesan ditandai `enqueue_unknown` dan error dikembalikan. Callback wajib bertanda tangan: tanpa `QSTASH_CURRENT_SIGNING_KEY` dan `QSTASH_NEXT_SIGNING_KEY`, endpoint workflow menolak semua permintaan (401) pada environment apa pun. `QSTASH_DEV` tidak boleh aktif di production; aplikasi menolak start. Jadwal dengan waktu yang sudah lewat ditolak dengan HTTP 400. Jadwal lama di SQLite tetap diproses oleh worker lokal setiap 60 detik sampai habis.
- Pesan terjadwal disimpan dengan status `scheduled`, `processing`, `sent`, `failed`, `unknown`, atau `enqueue_unknown`. Status `unknown`, `enqueue_unknown`, atau `processing` setelah proses berhenti memerlukan pemeriksaan manual sebelum dikirim ulang: operasi WhatsApp atau Redis mungkin sudah berhasil. Status ini tidak otomatis di-retry untuk mengurangi risiko pesan ganda.
- Timeout mengembalikan HTTP 408 dengan status pengiriman tidak diketahui. Timeout tidak membatalkan operasi WhatsApp; periksa chat sebelum mengirim ulang.
- Respons sukses `POST /messages/:id/forward` tidak lagi menyertakan `data.id` karena `Message.forward()` upstream tidak mengembalikan ID pesan baru. Pastikan konsumen tidak bergantung pada field tersebut.

Patch LID menggunakan `evalOnNewDoc` tetapi bergantung pada modul privat WhatsApp Web. Log melaporkan jika hook tidak tersedia; patch tidak menjamin penyelesaian `No LID for user` dan perlu diuji pada akun dan versi WhatsApp Web yang digunakan.

## Troubleshooting inisialisasi WhatsApp

Jika startup gagal dengan `TimeoutError` pada `Client.inject`, lihat log `WhatsApp initialization timeout diagnostic`: `page` menunjukkan apakah halaman berada pada login, `webVersion` adalah versi yang termuat, dan `hasSocketModel`/`socketState` menunjukkan kesiapan koneksi internal. Log ini tidak memuat QR, URL lengkap, nomor, atau token.

Jika `page` = `login` dan `hasSocketModel` = `false`, penyebabnya adalah [issue upstream #201988](https://github.com/wwebjs/whatsapp-web.js/issues/201988): WhatsApp Web terbaru mengarahkan sesi yang belum login ke `/login/`, yang tidak memiliki modul `WAWebSocketModel`, sehingga `Client.inject()` menunggu sampai timeout dan event `qr` tidak pernah dikirim. Menaikkan timeout tidak membantu. Per 2026-11-24 belum ada rilis upstream yang memperbaikinya (`whatsapp-web.js@1.34.8` masih memuat `inject()` yang sama).

Workaround terverifikasi: pin build WhatsApp Web yang lebih lama. Pada 2026-11-24, build `2.3000.1055837054-alpha` menghasilkan event `qr` (build `2.3000.1055857453-alpha` dan yang lebih baru gagal dengan `TimeoutError` yang sama). Unduh dari commit yang dikunci, periksa checksum, lalu atur env:

```bash
mkdir -p .wwebjs_cache
curl -fL -o .wwebjs_cache/2.3000.1055837054-alpha.html \
  https://raw.githubusercontent.com/wppconnect-team/wa-version/e6cec7b43adc11ae36f946421576d517ecdc80e2/html/2.3000.1055837054-alpha.html
echo "2b7984d1b085b09228ce104d73c6cce41e20cb52453867bb739fe239f1e96ff3  .wwebjs_cache/2.3000.1055837054-alpha.html" | sha256sum -c -
```

```env
WWEBJS_WEB_VERSION=2.3000.1055837054-alpha
# WWEBJS_WEB_CACHE_PATH=./.wwebjs_cache (default)
```

Ini hanya workaround sementara: WhatsApp dapat menolak build lama kapan saja, dan file ini tidak disertakan proyek. Hapus `WWEBJS_WEB_VERSION` setelah upstream merilis perbaikan. Cache bersifat strict: aplikasi gagal secara jelas jika file yang dipilih tidak ada; tidak diam-diam memakai versi terbaru. **Jangan gunakan file HTML yang tidak tepercaya:** Chromium akan menjalankannya pada konteks WhatsApp Web.

Jika state tetap `OPENING` atau `UNLAUNCHED`, periksa koneksi dan akses WhatsApp Web dari server, proxy/firewall, serta kesesuaian Chromium. Untuk koneksi yang lambat, `WWEBJS_AUTH_TIMEOUT_MS` dapat diubah dari default `30000`, misalnya menjadi `120000`; ini bukan perbaikan untuk issue `/login/` di atas. Jangan menghapus `.wwebjs_auth` atau cache yang ada tanpa backup.

## Requirements

- Node.js `^22.19.0 || ^24.0.0 || >=26.0.0`; gunakan Node.js 24 LTS jika memungkinkan. Node.js 18 dan 20 tidak lagi didukung oleh dependensi terbaru.
- pnpm 12.16.1; `pnpm-lock.yaml` adalah lockfile yang digunakan untuk instalasi reproducible.
- Chrome/Chromium yang kompatibel dengan Puppeteer, dikonfigurasi melalui `CHROMIUM_PATH` di `.env`. Script instalasi Puppeteer dinonaktifkan; browser tidak diunduh otomatis.
- Akun Upstash dengan Redis dan QStash. Endpoint `WORKFLOW_BASE_URL` harus dapat dijangkau dari internet oleh QStash.

Paket `better-sqlite3` menggunakan binary bawaan untuk platform yang didukung. Lifecycle scripts dependensi dibatasi di `pnpm-workspace.yaml`; platform tanpa binary bawaan memerlukan build native sesuai [panduan better-sqlite3](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/compilation.md).

## Upgrade dari versi sebelumnya

1. Backup database SQLite dan direktori sesi `.wwebjs_auth` sebelum deployment. Jangan menyalin keduanya ke repository.
2. Upgrade Node.js dan pnpm, lalu jalankan `pnpm install --frozen-lockfile`.
3. Pastikan `CHROMIUM_PATH` menunjuk ke browser yang terpasang, dan verifikasi `/health` serta pengiriman pesan pada lingkungan staging.

Versi SQLite yang dibawa `better-sqlite3` berubah saat upgrade; verifikasi kompatibilitas data dan rencana rollback sebelum deployment.

## Dokumentasi

Lihat [Wiki](https://github.com/NasroelLah/wwebjs_api/wiki/How-To) untuk panduan lengkap.
