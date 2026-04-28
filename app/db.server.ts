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

pool.query(`UPDATE "Item" SET is_active = false WHERE LOWER(category) = 'poo'`)
  .catch(console.error);

pool.query(`
  INSERT INTO "Item" (item_id, name, category, price, is_active, milk, ice, sugar, toppings, is_seasonal, quantity, min_quantity)
  SELECT gen_random_uuid(), v.name, 'Coffee', v.price, true, v.milk, 0, 0.0, '{}', false, 100, 0
  FROM (VALUES
    ('Espresso',               3.00::numeric, ''),
    ('Americano',              3.50::numeric, ''),
    ('Cold Brew',              4.50::numeric, ''),
    ('Latte',                  4.50::numeric, 'Whole Milk'),
    ('Cappuccino',             4.50::numeric, 'Whole Milk'),
    ('Iced Latte',             5.00::numeric, 'Whole Milk'),
    ('Vietnamese Iced Coffee', 4.50::numeric, 'Whole Milk')
  ) AS v(name, price, milk)
  WHERE NOT EXISTS (
    SELECT 1 FROM "Item" WHERE LOWER(category) = 'coffee'
  )
`).catch(console.error);

export default pool;
