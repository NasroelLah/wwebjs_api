# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
bun start           # or: node src/index.mjs
bun run dev         # or: node --watch src/index.mjs (auto-restart on change)

# Testing (Node.js built-in test runner)
node --test src/**/*.test.mjs              # run all tests
node --test src/helpers/cache.test.mjs    # run a single test file

# Linting
bun run lint        # ESLint check
bun run lint:fix    # ESLint auto-fix

# Health check (server must be running)
curl -f http://localhost:3030/health
```

## Architecture

The project uses **ES modules** exclusively — all source files use the `.mjs` extension with `import`/`export` syntax. No TypeScript.

### Startup Flow

`src/index.mjs` calls two parallel initializations:
1. `initializeWhatsApp()` — starts the WhatsApp client (Puppeteer/Chromium), registers event handlers, begins session restore or QR generation
2. `startServer()` — starts the Fastify HTTP server, registers plugins, mounts all route handlers

### WhatsApp Client (`src/whatsappClient.mjs`)

The singleton `client` (from `whatsapp-web.js`) uses `LocalAuth` to persist sessions in `.wwebjs_auth/`. The exported `clientState` string tracks four states: `DISCONNECTED → CONNECTING → CONNECTED → READY`. The exported `lastQr` holds the most recent QR code string. All API routes that interact with WhatsApp import these exports from this module.

### Request Lifecycle

```
HTTP Request
  → preHandler hook: validateApiKey() [middleware/auth.mjs]
  → preHandler hook: sanitizeRequest() [middleware/sanitize.mjs]
  → Route handler → Controller → whatsappClient / helpers
  → onSend hook: uniform response wrapper
```

### Authentication

All routes except `/`, `/api`, `/version`, `/health/*`, and `/docs/*` require `Authorization: Bearer <API_KEY>`. The key is set in `.env` as `API_KEY` and validated in `src/middleware/auth.mjs`.

### Queue System

Two queue backends are supported, controlled by `QUEUE_CONNECTION` env var:
- `cron` (default) — Bree scheduler, no Redis needed (`src/jobs/breeTasks.mjs`)
- `redis` — Bull queue backed by Redis (`src/helpers/queueHelper.mjs`)

Scheduled messages are persisted in SQLite (`data/whatsapp_api.db`) so they survive restarts.

### LLM Auto-Response

Optional feature enabled via `LLM_ENABLED=true`. Supports OpenAI, Anthropic Claude, Google Gemini, and OpenAI-compatible local LLMs (Ollama, LM Studio). Logic lives in `src/helpers/llmHelper.mjs` and is triggered from the `message` event handler in `whatsappClient.mjs`.

### Error Handling

Use `AppError` from `src/errors/AppError.mjs` for all thrown errors. It accepts an `ErrorType` enum value, HTTP status code, message, and `isOperational` flag. The centralized handler in `src/errors/ErrorHandler.mjs` formats responses and decides whether to exit the process.

## Key Files

| File | Purpose |
|------|---------|
| `src/config.mjs` | All env var parsing and validation — add new config here |
| `src/server.mjs` | Plugin registration and route mounting |
| `src/whatsappClient.mjs` | WhatsApp client singleton, state exports, event handlers |
| `src/routes/device.mjs` | QR code flow and connection lifecycle |
| `src/helpers/sendHelper.mjs` | Message sending with retry/backoff — use this for all sends |
| `src/helpers/dbHelper.mjs` | All SQLite access (scheduled messages, conversation history) |
| `public/index.html` | Device Manager UI (Alpine.js + Tailwind CDN, served as static) |

## Environment

Copy `.env.example` to `.env`. Minimum required: `API_KEY`. Server defaults to port `3030`. Requires Chrome/Chromium for Puppeteer (Chromium is bundled via `whatsapp-web.js`).
