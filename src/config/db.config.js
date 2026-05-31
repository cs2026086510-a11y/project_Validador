const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

console.log('====================================');
console.log('CONFIGURACIÓN CARGADA');
console.log('====================================');

const dbUrl = process.env.DATABASE_URL;

// 🔥 EN PRODUCCIÓN: SOLO DATABASE_URL
if (!dbUrl && process.env.NODE_ENV === 'production') {
  throw new Error('❌ DATABASE_URL no configurada en producción');
}

const poolConfig = dbUrl
  ? {
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false } // Railway/Postgres cloud
    }
  : {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    };

console.log('Modo:', dbUrl ? 'Railway / Producción' : 'Local');

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// ==============================
// INIT DB
// ==============================
const initDB = async () => {
  console.log('🔄 Probando conexión PostgreSQL...');

  const test = await pool.query('SELECT NOW()');

  console.log('✅ Conexión PostgreSQL exitosa');
  console.log('Hora servidor:', test.rows[0].now);

  const schemaPath = path.join(__dirname, '../database/schema.sql');

  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf8');

    if (schema.trim()) {
      await pool.query(schema);
      console.log('✅ Schema ejecutado correctamente');
    }
  }

  console.log('✅ Base de datos inicializada');
};

module.exports = {
  pool,
  initDB,
  query: (text, params) => pool.query(text, params)
};