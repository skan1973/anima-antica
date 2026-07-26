const Ban = require('../models/ban');
const net = require('node:net');

function normalizeIp(ip) {
    const normalized = typeof ip === 'string' ? ip.trim() : '';
    if (!normalized || net.isIP(normalized) === 0) {
        throw new Error('IP non valido');
    }
    return normalized;
}

function normalizeDuration(durationInMinutes) {
    const value = Number(durationInMinutes);
    if (!Number.isFinite(value) || value <= 0 || value > 60 * 24 * 30) {
        throw new Error('Durata ban non valida');
    }
    return value;
}

const banService = {
    async isIpBanned(ip) {
        const safeIp = normalizeIp(ip);
        const banned = await Ban.findOne({ ip: safeIp, expiresAt: { $gt: new Date() } });
        return !!banned;
    },

    async addBan(ip, durationInMinutes) {
        const safeIp = normalizeIp(ip);
        const safeDuration = normalizeDuration(durationInMinutes);
        const expiresAt = new Date(Date.now() + safeDuration * 60000);
        await Ban.findOneAndUpdate(
            { ip: safeIp },
            { expiresAt },
            { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
        );
    }
};

module.exports = banService;
