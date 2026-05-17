package api

// openAPISpec is a hand-curated OpenAPI 3.0 document describing the most
// important authenticated endpoints. It is intentionally not exhaustive —
// covering it from a single hand-maintained literal keeps the spec
// reviewable, while still giving external integrators (and the in-app
// Swagger UI, if we add one) a working contract for the core review flow.
//
// Served by GET /api/v1/openapi.json (auth not required so external
// generators / curl can pull it directly).
const openAPISpec = `{
  "openapi": "3.0.3",
  "info": {
    "title": "SkillHub API",
    "version": "1.0.0",
    "description": "Internal skill marketplace + review workflow. All endpoints under /api/v1 require Bearer auth unless noted otherwise."
  },
  "servers": [{ "url": "/api/v1" }],
  "components": {
    "securitySchemes": {
      "bearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT"
      }
    },
    "schemas": {
      "Error": {
        "type": "object",
        "properties": { "error": { "type": "string" } }
      },
      "LoginRequest": {
        "type": "object",
        "required": ["username", "password"],
        "properties": {
          "username": { "type": "string" },
          "password": { "type": "string" }
        }
      },
      "LoginResponse": {
        "type": "object",
        "properties": {
          "token": { "type": "string" },
          "user":  { "$ref": "#/components/schemas/User" }
        }
      },
      "User": {
        "type": "object",
        "properties": {
          "username": { "type": "string" },
          "display":  { "type": "string" },
          "role":     { "type": "string" },
          "team":     { "type": "string" },
          "email":    { "type": "string" },
          "isAdmin":  { "type": "boolean" }
        }
      },
      "Skill": {
        "type": "object",
        "properties": {
          "ns":             { "type": "string" },
          "name":           { "type": "string" },
          "description":    { "type": "string" },
          "classification": { "type": "string", "enum": ["L1","L2","L3"] },
          "status":         { "type": "string", "enum": ["draft","published","yanked","deprecated"] },
          "version":        { "type": "string" },
          "author":         { "type": "string" },
          "tags":           { "type": "array", "items": { "type": "string" } }
        }
      },
      "CreateSkillRequest": {
        "type": "object",
        "required": ["ns", "name", "classification"],
        "properties": {
          "ns":             { "type": "string" },
          "name":           { "type": "string" },
          "desc":           { "type": "string" },
          "classification": { "type": "string", "enum": ["L1","L2","L3"] },
          "tags":           { "type": "array", "items": { "type": "string" } },
          "templateId":     { "type": "string" }
        }
      },
      "Review": {
        "type": "object",
        "properties": {
          "id":             { "type": "integer", "format": "int64" },
          "ns":             { "type": "string" },
          "name":           { "type": "string" },
          "version":        { "type": "string" },
          "classification": { "type": "string" },
          "author":         { "type": "string" },
          "reviewers":      { "type": "array", "items": { "type": "string" } },
          "status":         { "type": "string", "enum": ["pending","approved","rejected","changes_requested"] },
          "urgency":        { "type": "string" },
          "submittedAt":    { "type": "string", "format": "date-time" }
        }
      },
      "SubmitReviewRequest": {
        "type": "object",
        "properties": {
          "version":      { "type": "string" },
          "note":         { "type": "string" },
          "reviewers":    { "type": "array", "items": { "type": "string" } },
          "isHotfix":     { "type": "boolean" },
          "hotfixReason": { "type": "string" }
        }
      },
      "DecisionRequest": {
        "type": "object",
        "required": ["decision"],
        "properties": {
          "decision": { "type": "string", "enum": ["approve","reject","request_changes"] },
          "note":     { "type": "string" }
        }
      },
      "Comment": {
        "type": "object",
        "properties": {
          "id":        { "type": "integer", "format": "int64" },
          "reviewId":  { "type": "integer", "format": "int64" },
          "author":    { "type": "string" },
          "body":      { "type": "string" },
          "filePath":  { "type": "string" },
          "lineNo":    { "type": "integer" },
          "side":      { "type": "string", "enum": ["", "base", "head"] },
          "createdAt": { "type": "string", "format": "date-time" }
        }
      },
      "CommentRequest": {
        "type": "object",
        "required": ["body"],
        "properties": {
          "body":     { "type": "string", "minLength": 1, "maxLength": 4000 },
          "filePath": { "type": "string" },
          "lineNo":   { "type": "integer" },
          "side":     { "type": "string", "enum": ["base","head"] }
        }
      }
    }
  },
  "security": [{ "bearerAuth": [] }],
  "paths": {
    "/auth/login": {
      "post": {
        "summary": "Exchange username + password for a JWT.",
        "security": [],
        "requestBody": {
          "required": true,
          "content": { "application/json": { "schema": { "$ref": "#/components/schemas/LoginRequest" } } }
        },
        "responses": {
          "200": { "description": "OK",
            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/LoginResponse" } } } },
          "401": { "description": "Invalid credentials",
            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } },
          "403": { "description": "Account disabled",
            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } }
        }
      }
    },
    "/me": {
      "get": {
        "summary": "Return the authenticated user profile.",
        "responses": {
          "200": { "description": "OK",
            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/User" } } } }
        }
      }
    },
    "/skills": {
      "get": {
        "summary": "List skills, optionally filtered.",
        "parameters": [
          { "name": "ns",             "in": "query", "schema": { "type": "string" } },
          { "name": "classification", "in": "query", "schema": { "type": "string" } },
          { "name": "status",         "in": "query", "schema": { "type": "string" } },
          { "name": "q",              "in": "query", "schema": { "type": "string" } },
          { "name": "limit",          "in": "query", "schema": { "type": "integer" } },
          { "name": "offset",         "in": "query", "schema": { "type": "integer" } }
        ],
        "responses": {
          "200": { "description": "OK",
            "content": { "application/json": { "schema": { "type": "array", "items": { "$ref": "#/components/schemas/Skill" } } } } }
        }
      },
      "post": {
        "summary": "Create a new draft skill.",
        "requestBody": {
          "required": true,
          "content": { "application/json": { "schema": { "$ref": "#/components/schemas/CreateSkillRequest" } } }
        },
        "responses": {
          "201": { "description": "Created",
            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Skill" } } } },
          "400": { "description": "Validation error" },
          "403": { "description": "Not a namespace member" }
        }
      }
    },
    "/skills/{ns}/{name}/submit": {
      "post": {
        "summary": "Submit a draft for review.",
        "parameters": [
          { "name": "ns",   "in": "path", "required": true, "schema": { "type": "string" } },
          { "name": "name", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "requestBody": {
          "required": true,
          "content": { "application/json": { "schema": { "$ref": "#/components/schemas/SubmitReviewRequest" } } }
        },
        "responses": {
          "201": { "description": "Review created",
            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Review" } } } },
          "403": { "description": "Forbidden (RBAC)" },
          "422": { "description": "Blocking validation failure" }
        }
      }
    },
    "/reviews": {
      "get": {
        "summary": "List reviews.",
        "responses": {
          "200": { "description": "OK",
            "content": { "application/json": { "schema": { "type": "array", "items": { "$ref": "#/components/schemas/Review" } } } } }
        }
      }
    },
    "/reviews/{id}/decision": {
      "post": {
        "summary": "Approve, reject, or request changes on a review.",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "integer" } }
        ],
        "requestBody": {
          "required": true,
          "content": { "application/json": { "schema": { "$ref": "#/components/schemas/DecisionRequest" } } }
        },
        "responses": {
          "200": { "description": "OK",
            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Review" } } } },
          "403": { "description": "Cannot self-approve, or not assigned" },
          "409": { "description": "Review already decided" }
        }
      }
    },
    "/reviews/{id}/comments": {
      "get": {
        "summary": "List comments on a review.",
        "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "integer" } }],
        "responses": {
          "200": { "description": "OK",
            "content": { "application/json": { "schema": { "type": "array", "items": { "$ref": "#/components/schemas/Comment" } } } } }
        }
      },
      "post": {
        "summary": "Add a comment to a review. Anchor with filePath+lineNo+side for inline diff comments.",
        "parameters": [{ "name": "id", "in": "path", "required": true, "schema": { "type": "integer" } }],
        "requestBody": {
          "required": true,
          "content": { "application/json": { "schema": { "$ref": "#/components/schemas/CommentRequest" } } }
        },
        "responses": {
          "201": { "description": "Created",
            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Comment" } } } },
          "400": { "description": "Empty or oversize body" }
        }
      }
    }
  }
}
`
