const mongoose = require('mongoose');
const net = require('node:net');

const banSchema = new mongoose.Schema({
    ip: {
        type: String,
        required: true,
        index: true,
        trim: true,
        validate: {
            validator: (value) => net.isIP(value) !== 0,
            message: 'IP non valido'
        }
    },
    expiresAt: { type: Date, required: true }
}, { strict: 'throw' });

module.exports = mongoose.model('Ban', banSchema);
