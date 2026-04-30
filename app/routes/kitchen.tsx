import { useEffect, useState, useContext } from "react";
import { useLoaderData, useFetcher, useRevalidator } from "react-router";
import type { Route } from "./+types/kitchen";
import pool from "../db.server";
import { translateText } from "../translate";
import { TranslationContext } from "../root";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Kitchen — Boba House" }];
}

interface KitchenLine {
  name: string;
  qty: number;
  size?: string | null;
  ice?: string | null;
  milk?: string | null;
  temp?: string | null;
  sweet?: number | null;
  toppings?: string | null;
}

interface KitchenOrder {
  id:           string;
  orderNumber:  number;
  customerName: string;
  date:         string;
  scheduledFor: string | null;
  items:        KitchenLine[];
}

function lineDetailText(line: KitchenLine): string | null {
  const parts: string[] = [];
  if (line.size) parts.push(line.size);
  if (line.ice) parts.push(`Ice ${line.ice}`);
  if (line.milk && line.milk !== "No Milk") parts.push(line.milk);
  if (line.temp) parts.push(line.temp.toLowerCase() === "hot" ? "Hot" : "Cold");
  if (line.sweet != null) parts.push(`${line.sweet}% sugar`);
  if (line.toppings && line.toppings.trim()) parts.push(line.toppings);
  return parts.length ? parts.join(" · ") : null;
}

export async function loader() {
  const result = await pool.query(
    `SELECT o.order_id::text AS id,
            o.order_number::int AS "orderNumber",
            COALESCE(NULLIF(TRIM(o.customer_name), ''), 'Walk-in Customer') AS "customerName",
            to_char(o.date AT TIME ZONE 'America/Chicago', 'HH12:MI AM') AS date,
            CASE
              WHEN o.scheduled_for IS NOT NULL
              THEN to_char(o.scheduled_for AT TIME ZONE 'America/Chicago', 'Mon DD, HH12:MI AM')
              ELSE NULL
            END AS "scheduledFor",
            json_agg(
              json_build_object(
                'name', i.name,
                'qty', oi.quantity,
                'size', oi.size,
                'ice', oi.ice_level,
                'milk', oi.milk_type,
                'temp', oi.temperature,
                'sweet', oi.sweetness,
                'toppings', COALESCE(array_to_string(oi.toppings, ', '), '')
              ) ORDER BY i.name
            ) AS items
     FROM "Order" o
     JOIN "Order_Item" oi ON oi.order_id = o.order_id
     JOIN "Item" i ON i.item_id = oi.item_id
     WHERE o.status IN ('pending', 'scheduled')
       AND o.date >= now() - interval '24 hours'
     GROUP BY o.order_id, o.order_number, o.customer_name, o.date, o.scheduled_for
     ORDER BY COALESCE(o.scheduled_for, o.date) ASC`
  );
  return { orders: result.rows as KitchenOrder[] };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const id = formData.get("id") as string;
  const result = await pool.query(
    `WITH completed AS (
       UPDATE "Order"
       SET status = 'completed'
       WHERE order_id = $1::uuid
         AND status IN ('pending', 'scheduled')
       RETURNING order_id
     ),
     consumed AS (
       SELECT oi.item_id, SUM(oi.quantity)::int AS qty
       FROM "Order_Item" oi
       JOIN completed c ON c.order_id = oi.order_id
       GROUP BY oi.item_id
     )
     UPDATE "Item" i
     SET quantity  = GREATEST(i.quantity - c.qty, 0),
         is_active = CASE WHEN (i.quantity - c.qty) < i.min_quantity THEN false ELSE i.is_active END
     FROM consumed c
     WHERE i.item_id = c.item_id
     RETURNING i.item_id`,
    [id]
  );
  return { ok: true, updatedItems: result.rowCount ?? 0 };
}

function OrderCard({ order }: { order: KitchenOrder }) {
  const fetcher   = useFetcher();
  const completing = fetcher.state !== "idle";
  const isScheduled = !!order.scheduledFor;

  return (
    <div className={`section-card flex flex-col min-h-48 ${isScheduled ? "border-purple-300" : ""}`}>
      <div className={`px-4 py-3 border-b rounded-t-[0.875rem] flex items-center justify-between
        ${isScheduled ? "bg-purple-50 border-purple-200" : "bg-slate-100/80 border-slate-200"}`}>
        <span className="text-sm font-bold text-slate-800">
          Order #{order.orderNumber}
        </span>
        <span className="text-xs text-slate-500">{order.date}</span>
      </div>

      {isScheduled && (
        <div className="px-4 py-2 bg-purple-600 flex items-center gap-1.5">
          <span className="text-white text-xs font-bold">📅 Scheduled — ready by {order.scheduledFor}</span>
        </div>
      )}

      <p className="px-4 pt-3 text-xs font-medium text-slate-500">Customer: {order.customerName}</p>
      <ul className="flex-1 px-4 py-3 space-y-1.5" role="list">
        {order.items.map((item, i) => {
          const details = lineDetailText(item);
          return (
            <li key={i} className="text-sm text-slate-700">
              <div className="flex items-baseline gap-1.5">
                <span className="font-semibold text-slate-900">×{item.qty}</span>
                <span className="font-medium">{item.name}</span>
              </div>
              {details && (
                <p className="text-xs text-slate-500 mt-1 pl-5 leading-snug">{details}</p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="px-4 pb-4">
        <fetcher.Form method="post">
          <input type="hidden" name="id" value={order.id} />
          <button
            type="submit"
            disabled={completing}
            className={`w-full py-2 focus:outline-none focus:ring-2 focus:ring-offset-2 text-white text-sm font-semibold rounded-lg transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed
              ${isScheduled
                ? "bg-purple-600 hover:bg-purple-700 focus:ring-purple-600"
                : "bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-600"}`}
          >
            {completing ? "Completing…" : "Mark Complete"}
          </button>
        </fetcher.Form>
      </div>
    </div>
  );
}

export default function Kitchen() {
  const { orders }    = useLoaderData<typeof loader>();
  const revalidator   = useRevalidator();

  const translationContext = useContext(TranslationContext);
  const language = translationContext?.language ?? "en";

  const [translatedUI, setTranslatedUI] = useState({
    activeQueue: "Active Queue",
    trackPending: "Track pending orders and mark them complete when fulfilled.",
    noPending: "No pending orders"
  });

  useEffect(() => {
    if (language === "en") {
      setTranslatedUI({
        activeQueue: "Active Queue",
        trackPending: "Track pending orders and mark them complete when fulfilled.",
        noPending: "No pending orders"
      });
      return;
    }
    Promise.all([
      translateText("Active Queue", { to: language }),
      translateText("Track pending orders and mark them complete when fulfilled.", { to: language }),
      translateText("No pending orders", { to: language })
    ]).then(([activeQueue, trackPending, noPending]) => {
      setTranslatedUI({ activeQueue, trackPending, noPending });
    });
  }, [language]);

  useEffect(() => {
    const t = window.setInterval(() => revalidator.revalidate(), 12000);
    return () => window.clearInterval(t);
  }, [revalidator]);

  const scheduled = orders.filter(o => o.scheduledFor);
  const active    = orders.filter(o => !o.scheduledFor);

  return (
    <div className="h-screen flex flex-col app-shell">
      <header className="app-header px-6 py-4 shrink-0">
        <div className="topbar-row">
          <div className="topbar-brand">
            <span className="brand-link">Boba House</span>
            <p className="topbar-tagline">Shop Operations Suite</p>
          </div>
          <span className="topbar-chip">Kitchen Display</span>
        </div>
      </header>

      <div className="flex-1 page-section w-full px-4 py-5 overflow-y-auto">
        {orders.length === 0 ? (
          <div className="section-card flex items-center justify-center h-[70vh]">
            <p className="text-slate-400 text-lg font-medium">{translatedUI.noPending}</p>
          </div>
        ) : (
          <>
            {active.length > 0 && (
              <div className="mb-6">
                <h2 className="section-title mb-3">{translatedUI.activeQueue}</h2>
                <div className="grid grid-cols-5 gap-4">
                  {active.map(order => <OrderCard key={order.id} order={order} />)}
                </div>
              </div>
            )}
            {scheduled.length > 0 && (
              <div>
                <h2 className="section-title mb-3 text-purple-700">📅 Scheduled Orders</h2>
                <div className="grid grid-cols-5 gap-4 pb-4">
                  {scheduled.map(order => <OrderCard key={order.id} order={order} />)}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <footer className="soft-footer px-6 py-1.5 shrink-0">
        <p className="text-xs">
          {active.length} active · {scheduled.length} scheduled
        </p>
      </footer>
    </div>
  );
}
