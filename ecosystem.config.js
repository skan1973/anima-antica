module.exports = {
  apps: [{
    name: "anima-antica",
    script: "server/server.js",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "512M",
    env: {
      NODE_ENV: "production"
    },
    // In produzione, i log dovrebbero essere gestiti dal sistema o da log collector, 
    // qui li disabilitiamo per evitare scritture non necessarie nel container.
    error_file: "/dev/null",
    out_file: "/dev/null"
  }]
};
