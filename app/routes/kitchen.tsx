import { useLoaderData, useNavigate, useFetcher } from "react-router";
import type { Route } from "./+types/kitchen";
import pool from "../db.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Kitchen — Boba House" }];
}

interface KitchenOrder {
  id:    string;
  date:  string;
  items: { name: string; qty: number }[];
}

export async function loader() {
  const result = await pool.query(
    `SELECT o.order_id::text AS id,
            to_char(o.date AT TIME ZONE 'America/Chicago', 'HH12:MI AM') AS date,
            json_agg(json_build_object('name', i.name, 'qty', oi.quantity) ORDER BY i.name) AS items
     FROM "Order" o
     JOIN "Order_Item" oi ON oi.order_id = o.order_id
     JOIN "Item" i ON i.item_id = oi.item_id
     WHERE o.status = 'pending'
       AND o.date >= now() - interval '12 hours'
     GROUP BY o.order_id, o.date
     ORDER BY o.date ASC`
  );
  return { orders: result.rows as KitchenOrder[] };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const id = formData.get("id") as string;
  await pool.query(
    `UPDATE "Order" SET status = 'completed' WHERE order_id = $1::uuid`,
    [id]
  );
  return { ok: true };
}

function OrderCard({ order }: { order: KitchenOrder }) {
  const fetcher = useFetcher();
  const completing = fetcher.state !== "idle";

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col min-h-48">
      <div className="px-4 py-3 bg-slate-100 border-b border-slate-200 rounded-t-lg flex items-center justify-between">
        <span className="text-sm font-bold text-slate-800">
          Order #{order.id.slice(-6).toUpperCase()}
        </span>
        <span className="text-xs text-slate-500">{order.date}</span>
      </div>
      <ul className="flex-1 px-4 py-3 space-y-1.5" role="list">
        {order.items.map((item, i) => (
          <li key={i} className="text-sm text-slate-700 flex items-baseline gap-1.5">
            <span className="font-semibold text-slate-900">×{item.qty}</span>
            {item.name}
          </li>
        ))}
      </ul>
      <div className="px-4 pb-4">
        <fetcher.Form method="post">
          <input type="hidden" name="id" value={order.id} />
          <button
            type="submit"
            disabled={completing}
            className="w-full py-2 bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2 text-white text-sm font-semibold rounded-lg transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {completing ? "Completing…" : "Mark Complete"}
          </button>
        </fetcher.Form>
      </div>
    </div>
  );
}

export default function Kitchen() {
  const navigate = useNavigate();
  const { orders } = useLoaderData<typeof loader>();

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      <header className="bg-slate-800 px-6 py-4 flex items-center justify-between shrink-0">
        <button
          onClick={() => navigate("/portal")}
          className="text-white text-xl font-bold tracking-wide hover:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-white rounded"
        >
          Boba House
        </button>
        <span className="text-slate-300 text-sm font-medium">Kitchen Display</span>
      </header>

      <div className="flex-1 p-5 overflow-y-auto">
        {orders.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-slate-400 text-lg font-medium">No pending orders</p>
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-4">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </div>

      <footer className="bg-slate-700 px-6 py-1.5 shrink-0">
        <p className="text-slate-300 text-xs">
          {orders.length} order{orders.length !== 1 ? "s" : ""} pending
        </p>
      </footer>
    </div>
  );
}
