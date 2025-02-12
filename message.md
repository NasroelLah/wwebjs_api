---
title: "Message API Documentation"
date: "2023-10-01"
description: "API documentation for the /message endpoint."
---

## Authentication

All requests must include an `Authorization` header with a valid Bearer token.

Example:

```http
Authorization: Bearer your_token_here
```

## Overview

This endpoint is used for sending messages via WhatsApp. It accepts different types of messages such as text, media (image, document, video, audio), and location.

## Endpoint

**POST** `/message`

## Request Schema

### Required Fields

- **recipient_type**: string, must be either `group` or `individual`
- **to**: string, WhatsApp number without special characters (only numbers)
- **type**: string, one of `text`, `image`, `document`, `video`, `audio`, or `location`

### Message Types

#### Text Message

- **text**: object with property `body` (string)

#### Media Message (image, document, video, audio)

- **media**: object with properties:
  - `url`: string (URI)
  - `base64`: string (optional)
  - `mimeType`: string (required if sending via base64)
  - `filename`: string (optional)
- **caption**: string (optional)

#### Location Message

- **location**: object with properties:
  - `latitude`: number (required)
  - `longitude`: number (required)
  - `address`: string (optional)

### Optional Fields

- **schedule**: string formatted as ISO date-time for scheduling the message

## Responses

- **200 Success**:
  - When the message is sent immediately or scheduled successfully.
- **400 Error**:
  - If a required field is missing.
- **500 Error**:
  - If an error occurs on the server side.

### Success Response Example

```json
{
  "status": "success",
  "message": "Message sent successfully."
}
```

### Error Response Examples

Unauthorized:

```json
{
  "status": "error",
  "message": "Unauthorized"
}
```

Bad Request:

```json
{
  "status": "error",
  "message": "Text body is required for text messages."
}
```

## Example Requests

### Text Message

```json
{
  "recipient_type": "individual",
  "to": "1234567890",
  "type": "text",
  "text": { "body": "Hello, world!" }
}
```

### Media Message with Caption

```json
{
  "recipient_type": "group",
  "to": "0987654321",
  "type": "image",
  "media": { "url": "https://example.com/image.jpg" },
  "caption": "Check this out!"
}
```

### Location Message

```json
{
  "recipient_type": "individual",
  "to": "1234567890",
  "type": "location",
  "location": {
    "latitude": -6.2,
    "longitude": 106.816666,
    "address": "Jakarta"
  }
}
```

// ...existing documentation...

```

```
