# nas-wapi

nas-wapi adalah REST API service yang mengintegrasikan WhatsApp Web untuk mengirim dan menerima pesan melalui webhook.

## Fitur

- Autentikasi menggunakan API key
- Mengirim pesan ke grup maupun individu via WhatsApp
- Pengiriman payload pesan ke webhook eksternal
- Rate limiting dan compress untuk optimalisasi performa

## Instalasi

1. Clone repository:
   ```bash
   git clone <repository_url>
   ```
2. Masuk ke folder project:
   ```bash
   cd wwebjs_api
   ```
3. Instal dependency:
   ```bash
   npm install
   ```
4. Buat file `.env` dan sesuaikan konfigurasi:
   ```properties
   API_KEY=your_api_key
   HOST_PORT=3030
   WEBHOOK_URL=https://hook.yourdomain.com/endpoint
   ENABLE_LOGGER=false
   RATE_LIMIT=100
   RATE_LIMIT_EXPIRE=60
   ```

## Penggunaan

1. Jalankan server:
   ```bash
   npm start
   ```
2. Untuk mengirim pesan, gunakan endpoint `/message` dengan payload JSON:
   ```json
   {
     "recipient_type": "individual",
     "to": "1234567890",
     "type": "text",
     "text": { "body": "Halo, ini pesan dari API!" }
   }
   ```

## Struktur Project

- `src/`
  - `config.mjs` – Konfigurasi environment dan setup project.
  - `server.mjs` – Setup Fastify server dan plugin.
  - `routes/message.mjs` – Endpoint REST API untuk mengirim pesan.
  - `whatsappClient.mjs` – Integrasi WhatsApp Web.
  - `gotInstance.mjs` – Konfigurasi got untuk webhook.
  - `index.mjs` – Entry point aplikasi.

## Logging & Error Handling

Aplikasi mengimplementasikan logging (aktif/nonaktif berdasarkan konfigurasi) dan penanganan global untuk unhandled promise rejection dan uncaught exceptions.

## Optimasi

- Rate limiting dengan konfigurasi dari file `.env`
- Response compression dengan threshold yang dapat dikonfigurasi
- Fitur clustering dapat diterapkan untuk pemanfaatan multi-core CPU

## Lisensi

Project ini dilisensikan sesuai dengan lisensi yang tertera dalam repository.
