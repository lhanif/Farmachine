// db.js
const { Pool } = require('pg');

// Konfigurasi koneksi PostgreSQL
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'farmachine',
  password: 'lhanif',
  port: 5432,
});

module.exports = pool;
