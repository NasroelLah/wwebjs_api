/**
 * JSON Schema definitions for API validation
 */

export const messageSchema = {
  body: {
    type: 'object',
    properties: {
      recipient_type: {
        type: 'string',
        enum: ['individual', 'group']
      },
      to: {
        type: 'string',
        pattern: '^[0-9]+$',
        minLength: 10,
        maxLength: 15
      },
      type: {
        type: 'string',
        enum: ['text', 'image', 'document', 'video', 'audio', 'location']
      },
      text: {
        type: 'object',
        properties: {
          body: {
            type: 'string',
            minLength: 1,
            maxLength: 4096
          }
        },
        required: ['body'],
        additionalProperties: false
      },
      media: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            format: 'uri'
          },
          base64: {
            type: 'string',
            pattern: '^[A-Za-z0-9+/]*={0,2}$'
          },
          mimeType: {
            type: 'string',
            pattern: '^[a-zA-Z0-9][a-zA-Z0-9!#$&^_]*/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*$'
          },
          filename: {
            type: 'string',
            maxLength: 255
          }
        },
        anyOf: [
          { required: ['url'] },
          { required: ['base64', 'mimeType'] }
        ],
        additionalProperties: false
      },
      location: {
        type: 'object',
        properties: {
          latitude: {
            type: 'number',
            minimum: -90,
            maximum: 90
          },
          longitude: {
            type: 'number',
            minimum: -180,
            maximum: 180
          },
          address: {
            type: 'string',
            maxLength: 500
          }
        },
        required: ['latitude', 'longitude'],
        additionalProperties: false
      },
      schedule: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$'
      },
      caption: {
        type: 'string',
        maxLength: 1024
      }
    },
    required: ['recipient_type', 'to', 'type'],
    additionalProperties: false,
    if: {
      properties: {
        type: { const: 'text' }
      }
    },
    then: {
      required: ['text']
    },
    else: {
      if: {
        properties: {
          type: { enum: ['image', 'document', 'video', 'audio'] }
        }
      },
      then: {
        required: ['media']
      },
      else: {
        if: {
          properties: {
            type: { const: 'location' }
          }
        },
        then: {
          required: ['location']
        }
      }
    }
  }
};

export const batchMessageSchema = {
  body: {
    type: 'object',
    properties: {
      messages: {
        type: 'array',
        minItems: 1,
        maxItems: 50, // Limit batch size
        items: messageSchema.body
      }
    },
    required: ['messages'],
    additionalProperties: false
  }
};

// Response schemas for documentation
export const successResponseSchema = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['success']
    },
    message: {
      type: 'string'
    },
    data: {
      type: 'object'
    }
  },
  required: ['status', 'message']
};

export const errorResponseSchema = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['error']
    },
    message: {
      type: 'string'
    },
    details: {
      type: 'object'
    }
  },
  required: ['status', 'message']
};
