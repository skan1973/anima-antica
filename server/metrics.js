// server/metrics.js
// Mock per sistema metriche (da integrare con prom-client se necessario in futuro)
const registry = {
    token_registry_size: { redis: 0, memory: 0 },
    token_registry_cleanup_total: 0,
    token_registry_operations_total: {}, // { "set|redis|ok": 0 }
    token_registry_ttl_seconds: 0
};

const recordOp = (op, store, status) => {
    const key = `${op}|${store}|${status}`;
    registry.token_registry_operations_total[key] = (registry.token_registry_operations_total[key] || 0) + 1;
};

const recordCleanup = (removedCount) => {
    registry.token_registry_cleanup_total += removedCount;
};

const updateRegistrySize = (store, size) => {
    registry.token_registry_size[store] = size;
};

const setTtlGauge = (seconds) => {
    registry.token_registry_ttl_seconds = seconds;
};

const getMetrics = () => registry;

module.exports = {
    recordOp,
    recordCleanup,
    updateRegistrySize,
    setTtlGauge,
    getMetrics
};
