---
title: "Message API"
date: 2023-10-10T12:00:00Z
draft: false
---

## Message API

### POST /message

Send a message to a specified recipient.

#### Request Headers

- `Authorization`: Bearer token for API authentication.

#### Request Body

- `recipient_type` (string): Type of recipient, either "group" or "individual".
- `to` (string): Recipient ID.
- `type` (string): Type of message (e.g., text, media).
- `text` (string, optional): Text content of the message.
- `media` (object, optional): Media content of the message.
- `location` (object, optional): Location content of the message.
- `schedule` (object, optional): Schedule information for the message.
- `caption` (string, optional): Caption for the media content.

#### Example Payloads

##### Text Message
```json
{
  "recipient_type": "individual",
  "to": "123456789",
  "type": "text",
  "text": "Hello, this is a text message."
}
```

##### Media Message
```json
{
  "recipient_type": "individual",
  "to": "123456789",
  "type": "media",
  "media": {
    "url": "http://example.com/image.jpg",
    "type": "image"
  },
  "caption": "This is an image."
}
```

##### Location Message
```json
{
  "recipient_type": "individual",
  "to": "123456789",
  "type": "location",
  "location": {
    "latitude": 37.7749,
    "longitude": -122.4194,
    "name": "San Francisco",
    "address": "San Francisco, CA"
  }
}
```

##### Scheduled Message
```json
{
  "recipient_type": "individual",
  "to": "123456789",
  "type": "text",
  "text": "This is a scheduled message.",
  "schedule": {
    "time": "2023-10-10T15:00:00Z"
  }
}
```

#### Responses

- `200 OK`: 
  - `status` (string): "success".
  - `message` (string): Success message.
- `401 Unauthorized`: 
  - `status` (string): "error".
  - `message` (string): Error message for missing or invalid API key.
- `500 Internal Server Error`: 
  - `status` (string): "error".
  - `message` (string): Error message for failed message sending.
