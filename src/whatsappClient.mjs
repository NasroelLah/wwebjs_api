import qrcode from "qrcode-terminal";
import { createRequire } from "module";
import { gotInstance } from "./gotInstance.mjs";
import { WEBHOOK_URL } from "./config.mjs";

const require = createRequire(import.meta.url);
const { Client, LocalAuth } = require("whatsapp-web.js");

export const client = new Client({
  authStrategy: new LocalAuth(),
});

// Tampilkan QR code saat client belum terautentikasi
client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
  console.log("Silakan scan QR code untuk login ke WhatsApp");
});

// Event ketika client siap digunakan
client.on("ready", () => {
  console.log("WhatsApp Client siap digunakan!");
});

// Event ketika terjadi kegagalan autentikasi
client.on("auth_failure", (msg) => {
  console.error("Authentication Failure:", msg);
});

// Event ketika client terputus (disconnected)
client.on("disconnected", (reason) => {
  console.log("WhatsApp Client disconnected:", reason);
});

// Event listener untuk pesan masuk
client.on("message", async (msg) => {
  console.log("Pesan diterima:", msg.body);

  if (!WEBHOOK_URL) {
    console.error("WEBHOOK_URL tidak diset di .env");
    return;
  }

  // Tentukan apakah pesan berasal dari grup atau individu berdasarkan suffix pada msg.from
  const isGroup = msg.from.endsWith("@g.us");

  // Bersihkan properti 'from' sehingga hanya berisi nomor saja
  let cleanedFrom = msg.from;
  if (msg.from.endsWith("@c.us")) {
    cleanedFrom = msg.from.replace("@c.us", "");
  } else if (msg.from.endsWith("@g.us")) {
    cleanedFrom = msg.from.replace("@g.us", "");
  }

  // Tentukan asal pesan
  const origin = isGroup ? "group" : "individual";

  // Jika pesan berasal dari grup, ekstrak nomor pengirim dari bagian terakhir id
  let senderNumber;
  if (isGroup) {
    // Format id grup: "false_{group}@g.us_{random}_{sender}@c.us"
    const parts = msg.id._serialized.split("_");
    if (parts.length >= 1) {
      // Ambil bagian terakhir dan hilangkan '@c.us'
      senderNumber = parts[parts.length - 1].replace("@c.us", "");
    }
  }

  // Buat payload webhook dengan informasi tambahan
  const payload = {
    from: cleanedFrom,
    body: msg.body,
    timestamp: msg.timestamp,
    id: msg.id._serialized,
    origin,
  };

  if (isGroup && senderNumber) {
    payload.fromNumber = senderNumber;
  }

  try {
    await gotInstance.post(WEBHOOK_URL, {
      json: payload,
    });
    console.log("Data pesan berhasil dikirim ke webhook");
  } catch (error) {
    console.error("Gagal mengirim data ke webhook:", error.message);
  }
});

export function initializeWhatsApp() {
  client.initialize();
}
