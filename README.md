# nas-wapi

nas-wapi adalah REST API service yang mengintegrasikan WhatsApp Web untuk mengirim dan menerima pesan melalui webhook.

## Fitur

- Autentikasi menggunakan Bearer token
- Mengirim pesan ke grup maupun individu via WhatsApp
- Pengiriman payload pesan ke webhook eksternal
- Rate limiting dan compress untuk optimalisasi performa

## Instalasi

1. Clone repository:
   ```bash
   git clone https://github.com/NasroelLah/wwebjs_api
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
2. Untuk mengirim pesan, gunakan endpoint `/message` dengan payload JSON dan sertakan header Authorization:

   ```http
   Authorization: Bearer your_api_key
   ```

   ```json
   {
     "recipient_type": "individual",
     "to": "1234567890",
     "type": "text",
     "text": { "body": "Halo, ini pesan dari API!" }
   }
   ```

## API Documentation

### POST /message

Endpoint untuk mengirim pesan menggunakan WhatsApp.

#### Request Body Umum

- recipient_type (string, required): "group" atau "individual"
- to (string, required): Nomor tujuan (tanpa kode negara)
- type (string, required): "text", "image", atau "document"
- text (object, required untuk type "text"):
  - body (string, required): Isi pesan
- media (object, required untuk type "image" atau "document"):
  - url (string): URL media (opsional, jika tidak menggunakan base64)
  - base64 (string): Data media dalam format base64 (opsional, jika tidak menggunakan URL)
  - mimeType (string): Tipe MIME media (wajib jika menggunakan base64)
  - filename (string): Nama file (opsional)

#### Contoh Request

Text Message (individual):

```json
{
  "recipient_type": "individual",
  "to": "1234567890",
  "type": "text",
  "text": { "body": "Halo, ini pesan teks dari API!" }
}
```

Text Message (group):

```json
{
  "recipient_type": "individual",
  "to": "1234567890434433", #group_id
  "type": "text",
  "text": { "body": "Halo, ini pesan teks dari API!" }
}
```

Image Message:

```json
{
  "recipient_type": "group",
  "to": "groupid",
  "type": "image",
  "media": { "url": "https://example.com/image.jpg" }
}
```

Document Message:

```json
{
  "recipient_type": "individual",
  "to": "1234567890",
  "type": "document",
  "media": {
    "base64": "base64_encoded_string_here",
    "mimeType": "application/pdf",
    "filename": "document.pdf"
  }
}
```

#### Response

- Success (200):
  ```json
  { "status": "success", "message": "Message sent to [recipient_type] [to]" }
  ```
- Error (400/500):
  ```json
  { "status": "error", "message": "Deskripsi error" }
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
