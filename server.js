import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 8000;
const HOST = '0.0.0.0';

const MIME_TYPES = {
    '.html': 'text/html; charset=UTF-8',
    '.js': 'text/javascript; charset=UTF-8',
    '.mjs': 'text/javascript; charset=UTF-8',
    '.css': 'text/css; charset=UTF-8',
    '.json': 'application/json; charset=UTF-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf'
};

// In-memory cache for audio chunks to enable instant zero-latency replays
const audioCache = new Map();

function handleTtsRequest(req, res, urlObj) {
    const tl = urlObj.searchParams.get('tl') || 'ta';
    const q = urlObj.searchParams.get('q') || '';

    if (!q.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Text query parameter q is required' }));
        return;
    }

    const cacheKey = `${tl}:${q.trim()}`;
    if (audioCache.has(cacheKey)) {
        const cached = audioCache.get(cacheKey);
        res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Length': cached.length,
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(cached);
        return;
    }

    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=gtx&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(q.trim())}`;
    
    const requestOptions = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*'
        }
    };

    https.get(ttsUrl, requestOptions, (ttsRes) => {
        if (ttsRes.statusCode !== 200) {
            console.warn(`[TTS Proxy] Upstream returned status ${ttsRes.statusCode} for query: ${q.substring(0, 30)}...`);
            res.writeHead(ttsRes.statusCode || 502, { 'Access-Control-Allow-Origin': '*' });
            ttsRes.pipe(res);
            return;
        }

        const chunks = [];
        ttsRes.on('data', chunk => chunks.push(chunk));
        ttsRes.on('end', () => {
            const buffer = Buffer.concat(chunks);
            // Cache if valid mp3 buffer
            if (buffer.length > 500 && audioCache.size < 500) {
                audioCache.set(cacheKey, buffer);
            }
            res.writeHead(200, {
                'Content-Type': 'audio/mpeg',
                'Content-Length': buffer.length,
                'Cache-Control': 'public, max-age=86400',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(buffer);
        });
    }).on('error', (err) => {
        console.error('[TTS Proxy] Fetch error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Failed to stream TTS audio', details: err.message }));
    });
}

const server = http.createServer((req, res) => {
    // Enable CORS for all local network requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const host = req.headers.host || `localhost:${PORT}`;
    const urlObj = new URL(req.url, `http://${host}`);

    // Handle TTS API endpoint
    if (urlObj.pathname === '/api/tts') {
        handleTtsRequest(req, res, urlObj);
        return;
    }

    // Static file serving
    let safePath = path.normalize(decodeURIComponent(urlObj.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (safePath === '/' || safePath === '\\') {
        safePath = '/index.html';
    }

    const filePath = path.join(__dirname, safePath);

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stats.size,
            'Cache-Control': 'no-cache'
        });

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
    });
});

server.listen(PORT, HOST, () => {
    console.log(`====================================================`);
    console.log(`🛡️  NutriGuard AI Server with Tamil & English TTS`);
    console.log(`    Running at: http://localhost:${PORT}/`);
    console.log(`    Local Network: http://192.168.137.180:${PORT}/`);
    console.log(`    TTS Proxy: http://localhost:${PORT}/api/tts?tl=ta&q=...`);
    console.log(`====================================================`);
});
