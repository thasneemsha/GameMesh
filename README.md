# GameMesh
> is a server-side Node.js application that demonstrates a **synchronous API mashup workflow** that combines Twitch live ecosystem data with RAWG game intelligence to help users explore trending games, creators, and gaming communities.

- Twitch API (OAuth 2.0 authentication required)
- RAWG Video Games Database API (API key authentication)

The server processes user input, performs dependent API calls, and returns a unified HTML results page.

---

## 2. System Goals

- Accept user input through a web form
- Authenticate and retrieve data from Twitch API
- Use Twitch response to drive further API requests
- Fetch supplementary game metadata from RAWG API
- Generate and return a combined, server-rendered HTML page
- Ensure strict **sequential (non-parallel) API execution**

---

## 3. Architecture Summary

- Runtime: Node.js (HTTP module only)
- No frameworks (no Express)
- No frontend build tools
- Server-rendered HTML output
- Fully backend-driven API orchestration

---

## 4. APIs Used

### 4.1 Twitch API (Primary / Authenticated API)
Used for:
- OAuth 2.0 Client Credentials authentication
- Game validation
- Retrieving Twitch game ID
- Fetching live stream data

Authentication:
- OAuth 2.0 Client Credentials Flow
- Access token cached server-side

---

### 4.2 RAWG API (Secondary API)
Used for:
- Game ratings
- Genres
- Platforms
- Screenshots
- Metadata enrichment

Authentication:
- API Key (query parameter)

---

## 5. Core Execution Flow

The system enforces strict sequential execution:

1. User submits a game name
2. Server requests OAuth token (if not cached)
3. Server queries Twitch `/helix/games`
4. Server extracts game ID and metadata
5. Server queries Twitch `/helix/streams`
6. Server then queries RAWG API using Twitch-derived data
7. Server merges responses and renders HTML

---

## 6. Key Design Decisions

### 6.1 Strict API Sequencing
- RAWG API is never called before Twitch response is fully resolved
- Prevents race conditions and ensures dependency correctness

### 6.2 Token Caching Strategy
- OAuth token stored locally (`cache/token.json`)
- Reduces redundant authentication requests
- Improves performance and API rate efficiency

### 6.3 Server-Side Rendering
- All HTML is generated on the server
- No client-side API calls required
- Ensures full control over data flow

### 6.4 Error Handling Strategy
- Graceful fallback for:
  - API timeout
  - Invalid game search
  - Empty API responses
- User always receives a readable HTML response

---

## 7. Project Structure

```text
CS355-FP/
│
├── index.js                  # Main server logic (API orchestration)
├── html/
│   └── index.html           # Search form UI
├── cache/
│   └── token.json           # OAuth token cache
└── auth/
    └── credentials.json     # API keys (not committed to public repo)
