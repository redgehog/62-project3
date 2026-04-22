import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
});

pool.query(`
  ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS is_seasonal boolean NOT NULL DEFAULT false
`).catch(console.error);

pool.query(`
  ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS quantity int NOT NULL DEFAULT 0
`).catch(console.error);

pool.query(`
  ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS min_quantity int NOT NULL DEFAULT 0
`).catch(console.error);

pool.query(`
  ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
`).catch(console.error);

pool.query(`
  ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS customer_name text NOT NULL DEFAULT 'Walk-in Customer'
`).catch(console.error);

pool.query(`
  ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS order_number int NOT NULL DEFAULT 1
`).catch(console.error);

pool.query(`
  ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS pin text
`).catch(console.error);

export default pool;
