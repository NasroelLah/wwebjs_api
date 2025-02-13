# nas-wapi

nas-wapi adalah REST API service yang mengintegrasikan WhatsApp Web untuk mengirim dan menerima pesan melalui webhook.

## Fitur

- Autentikasi menggunakan Bearer token
- Mengirim pesan ke grup maupun individual
- Mengirim pesan teks, gambar, dan dokumen
- Mengatur jadwal pengiriman pesan
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
4. Salin file `.env.example` ke `.env` dan sesuaikan konfigurasi yang diperlukan.

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
- to (string, required): Nomor tujuan (tanpa +)
- type (string, required): "text", "image", atau "document"
- text (object, required untuk type "text"):
  - body (string, required): Isi pesan
- media (object, required untuk type "image" atau "document"):
  - url (string): URL media (opsional, jika tidak menggunakan base64)
  - base64 (string): Data media dalam format base64 (opsional, jika tidak menggunakan URL)
  - mimeType (string): Tipe MIME media (wajib jika menggunakan base64)
  - filename (string): Nama file (opsional)
- caption (string): Keterangan media (opsional)
- schedule (string): Jadwal pengiriman pesan (opsional)

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
  "media": {
    "url": "https://example.com/image.jpg"
  },
  "caption": "Ini adalah gambar!"
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
  },
  "caption": "Dokumen ini penting!"
}
```

Schedule Message:

```json
{
  "recipient_type": "individual",
  "to": "1234567890",
  "type": "text",
  "text": {
    "body": "Halo, ini pesan teks dari API!"
  },
  "schedule": "2025-12-31 23:59:59"
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
