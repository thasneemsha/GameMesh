const fs          = require("fs");
const http        = require("http");
const https       = require("https");

// --- Configuration ---
const credentials  = require("./auth/credentials.json");
const port         = process.env.PORT || 3000;

const client_id     = credentials["Client-ID"];
const client_secret = credentials["Client-Secret"];
const rawg_key      = credentials["RAWG-Key"];

const twitch_token_hostname = "id.twitch.tv";
const twitch_token_path     = "/oauth2/token";
const twitch_api_hostname   = "api.twitch.tv";
const rawg_hostname         = "api.rawg.io";

const global_headers = { "Content-Type": "text/html" };

// Token cache — stored in memory (and on disk for restarts)
const token_cache_file = "./cache/token.json";

// --- Server Setup ---
const server = http.createServer();
server.on("request", request_handler);
server.on("listening", listen_handler);
server.listen(port);

// --- Handlers ---
function listen_handler() {
    console.log(`Now Listening on Port ${port}`);
}

function request_handler(req, res) {
    console.log(`New Request: ${req.url}`);

    if (req.url === "/") {
        const form = fs.createReadStream("html/index.html");
        res.writeHead(200, global_headers);
        form.pipe(res);
    }
    else if (req.url.startsWith("/search")) {
        const user_input = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const game = user_input.get("game");

        if (game === null || game === "") {
            send_results("", "", "", 400, res);
        }
        else {
            get_token(game, res);
        }
    }
    else if (req.url === "/favicon.ico") {
        res.writeHead(204);
        res.end();
    }
    else {
        res.writeHead(404, global_headers);
        res.end("<h1>404 Not Found</h1>");
    }
}

// --- Step 1: Get Twitch OAuth Token (with cache) ---
// This is the extra step OAuth 2.0 CC requires before any real API call.
// We check disk cache first. If valid, skip straight to Twitch game search.
// If expired or missing, POST to Twitch for a new token first.
function get_token(game, res) {
    fs.readFile(token_cache_file, { encoding: "utf8" }, function(err, raw) {
        if (!err) {
            try {
                const cached = JSON.parse(raw);
                if (Date.now() < cached.expires_at) {
                    console.log("Using cached token");
                    call_twitch(game, cached.access_token, res);
                    return;
                }
            } catch(e) {}
        }
        console.log("Fetching new token from Twitch");
        fetch_token(game, res);
    });
}

// --- Step 1b: POST to Twitch for a fresh token ---
function fetch_token(game, res) {
    const post_body = `client_id=${client_id}&client_secret=${client_secret}&grant_type=client_credentials`;

    const options = {
        hostname: twitch_token_hostname,
        path:     twitch_token_path,
        method:   "POST",
        headers: {
            "Content-Type":   "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(post_body)
        }
    };

    const token_req = https.request(options);
    token_req.once("response", (token_res) => process_http_stream(token_res, parse_token, game, res));
    token_req.once("error", () => send_results("", "", "", 500, res));
    token_req.setTimeout(5000, function() {
        console.log("Token request timed out");
        token_req.destroy();
        send_results("", "", "", 504, res);
    });
    token_req.write(post_body);
    token_req.end();
}

// --- Parse token response, save to cache, move to Twitch game search ---
function parse_token(body, status_code, game, res) {
    if (!status_code.toString().startsWith("2")) {
        send_results("", "", "", 500, res);
        return;
    }
    try {
        const token_data = JSON.parse(body);
        const cache_entry = {
            access_token: token_data.access_token,
            expires_at:   Date.now() + (token_data.expires_in * 1000) - 60000
        };
        // Save token to disk (fire-and-forget — we do not wait for this)
        fs.writeFile(token_cache_file, JSON.stringify(cache_entry), () => {});
        call_twitch(game, token_data.access_token, res);
    } catch(e) {
        send_results("", "", "", 500, res);
    }
}

// --- Step 2: Call Twitch API (API 1) ---
function call_twitch(game, token, res) {
    console.log("Calling Twitch API");
    const options = {
        hostname: twitch_api_hostname,
        path:     `/helix/games?name=${encodeURIComponent(game)}`,
        method:   "GET",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Client-Id":     client_id
        }
    };

    const twitch_req = https.request(options);
    twitch_req.once("response", (twitch_res) => process_http_stream(twitch_res, parse_twitch, game, token, res));
    twitch_req.once("error", () => send_results("", "", "", 500, res));
    twitch_req.setTimeout(5000, function() {
        console.log("Twitch request timed out");
        twitch_req.destroy();
        send_results("", "", "", 504, res);
    });
    twitch_req.end();
}

// --- Parse Twitch response, then call RAWG ---
// Twitch result (game name) is passed into the RAWG call.
// RAWG is ONLY called here — inside Twitch's callback.
// This is what makes the two API calls synchronous.
function parse_twitch(body, status_code, game, token, res) {
    if (!status_code.toString().startsWith("2")) {
        send_results("", "", "", 500, res);
        return;
    }
    try {
        const data = JSON.parse(body);
        if (!data.data || data.data.length === 0) {
            send_results(game, "", "", 404, res);
            return;
        }
        const twitch_name = data.data[0].name;
        console.log(`Twitch found: "${twitch_name}" — now calling RAWG`);
        call_rawg(twitch_name, res);   // <-- API 2 starts here, inside API 1's callback
    } catch(e) {
        send_results("", "", "", 500, res);
    }
}

// --- Step 3: Call RAWG API (API 2) ---
function call_rawg(twitch_name, res) {
    console.log("Calling RAWG API");
    const options = {
        hostname: rawg_hostname,
        path:     `/api/games?search=${encodeURIComponent(twitch_name)}&key=${rawg_key}&page_size=1`,
        method:   "GET"
    };

    const rawg_req = https.request(options);
    rawg_req.once("response", (rawg_res) => process_http_stream(rawg_res, parse_rawg, twitch_name, res));
    rawg_req.once("error", () => send_results("", "", "", 500, res));
    rawg_req.setTimeout(5000, function() {
        console.log("RAWG request timed out");
        rawg_req.destroy();
        send_results("", "", "", 504, res);
    });
    rawg_req.end();
}

// --- Parse RAWG response and send final result to user ---
function parse_rawg(body, status_code, twitch_name, res) {
    if (!status_code.toString().startsWith("2")) {
        send_results(twitch_name, "", "", 500, res);
        return;
    }
    try {
        const data = JSON.parse(body);
        if (!data.results || data.results.length === 0) {
            send_results(twitch_name, "N/A", "N/A", 404, res);
            return;
        }
        const game    = data.results[0];
        const rating  = game.rating     || "N/A";
        const metacritic = game.metacritic || "N/A";
        send_results(twitch_name, rating, metacritic, 200, res);
    } catch(e) {
        send_results("", "", "", 500, res);
    }
}

// --- Utility: collect chunked HTTP stream then call callback ---
// This is the exact pattern from the professor's dictionary example.
function process_http_stream(stream, callback, ...args) {
    const { statusCode: status_code } = stream;
    let body = "";
    stream.on("data", function(chunk) {
        body += chunk;
    });
    stream.on("end", () => callback(body, status_code, ...args));
}

// --- Send final HTML response to user ---
function send_results(game, rating, metacritic, response_code, res) {
    let results_html = "";
    switch (response_code) {
    case 200:
        results_html = `
            <h1>Results: ${game}</h1>
            <p><strong>RAWG Rating:</strong> ${rating} / 5</p>
            <p><strong>Metacritic:</strong> ${metacritic}</p>
            <a href="/">Search again</a>`;
        break;
    case 400:
        results_html = "<h1>Bad Request</h1><p>Please enter a game name.</p><a href='/'>Go back</a>";
        break;
    case 404:
        results_html = `<h1>No Results Found</h1><p>Could not find "${game}" on Twitch or RAWG.</p><a href='/'>Go back</a>`;
        break;
    case 504:
        results_html = "<h1>API Error: Gateway Timeout</h1><p>An API took too long to respond.</p><a href='/'>Go back</a>";
        break;
    default:
        results_html = `<h1>API Error (${response_code})</h1><a href='/'>Go back</a>`;
    }
    res.writeHead(response_code, global_headers);
    res.end(results_html);
}
