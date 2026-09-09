/**
 * Admin authentication middleware (C4).
 *
 * Gate sensitive endpoints (engine start/stop/mode, training kicks,
 * AI proxy, settings writes, WS auth signature) behind a shared
 * X-API-Key header.
 *
 * Behavior:
 *   - True same-machine localhost (127.0.0.1 / ::1) with no proxy
 *     forwarding headers is exempt — local dashboard / curl without a key.
 *   - Requests that arrive via a reverse proxy (X-Real-IP or
 *     X-Forwarded-For present) are NEVER localhost-exempt, even when
 *     req.ip is 127.0.0.1 (nginx → node hop). They must present ADMIN_API_KEY.
 *   - If ADMIN_API_KEY env var is unset, default-deny with 503. Opt-in
 *     by setting the env (not opt-out by leaving it blank).
 *   - Otherwise compare X-API-Key (or Bearer token) header against env.
 *
 * Usage:
 *   import { requireAdminAuth } from '../middleware/adminAuth.js';
 *   router.post('/sensitive-endpoint', requireAdminAuth, handler);
 *   // or, whole-router:
 *   app.use('/api/engines', requireAdminAuth, engineRoutes);
 */

function isLocalhostIp(ip) {
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function hasProxyClientHeaders(headers) {
    if (!headers) return false;
    return Boolean(headers['x-real-ip'] || headers['x-forwarded-for']);
}

export function requireAdminAuth(req, res, next) {
    const ip = req.ip || req.connection?.remoteAddress;
    const proxied = hasProxyClientHeaders(req.headers);

    // Localhost exemption only for direct same-machine calls — not nginx→node.
    if (!proxied && isLocalhostIp(ip)) {
        return next();
    }

    const expected = process.env.ADMIN_API_KEY;
    if (!expected) {
        return res.status(503).json({
            error: 'Admin endpoint disabled: ADMIN_API_KEY env not set on server',
        });
    }

    const header = req.headers['x-api-key'] ||
        (req.headers['authorization'] && req.headers['authorization'].replace(/^Bearer\s+/i, ''));

    if (header !== expected) {
        return res.status(401).json({ error: 'Unauthorized: invalid X-API-Key header' });
    }

    next();
}
