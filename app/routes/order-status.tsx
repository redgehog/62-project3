import { useEffect } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import type { Route } from "./+types/order-status";
import pool from "../db.server";

export function meta() {
  return [{ title: "Order Status — Boba House" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const orderNumber = parseInt(url.searchParams.get("n") ?? "0", 10);
  if (!orderNumber) return { order: null };
  const { rows } = await pool.query(
    `SELECT order_number AS "orderNumber", customer_name AS "customerName", status
     FROM "Order"
     WHERE order_number = $1
     ORDER BY date DESC LIMIT 1`,
    [orderNumber]
  );
  return {
    order: (rows[0] ?? null) as {
      orderNumber: number;
      customerName: string | null;
      status: string;
    } | null,
  };
}

export default function OrderStatus() {
  const { order } = useLoaderData<typeof loader>();
  const { revalidate } = useRevalidator();

  useEffect(() => {
    if (!order || order.status === "completed") return;
    const id = setInterval(revalidate, 5000);
    return () => clearInterval(id);
  }, [order, revalidate]);

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center p-8">
          <p className="text-5xl">🧋</p>
          <h1 className="text-xl font-bold text-slate-700 mt-3">Order not found</h1>
          <p className="text-slate-500 text-sm mt-1">Double-check your order number.</p>
        </div>
      </div>
    );
  }

  const isDone = order.status === "completed";

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <div className="text-5xl mb-4">{isDone ? "🎉" : "🧋"}</div>
        <h1 className="text-2xl font-black text-slate-900">
          Order #{order.orderNumber}
        </h1>
        {order.customerName && (
          <p className="text-slate-500 text-sm mt-1">{order.customerName}</p>
        )}
        <div
          className={`mt-6 rounded-xl py-5 px-6 ${
            isDone
              ? "bg-emerald-50 border border-emerald-200"
              : "bg-amber-50 border border-amber-200"
          }`}
        >
          {isDone ? (
            <>
              <p className="text-emerald-700 font-bold text-lg">Your order is ready!</p>
              <p className="text-emerald-600 text-sm mt-1">Come pick it up at the counter</p>
            </>
          ) : (
            <>
              <div className="flex items-center justify-center gap-1.5 mb-2">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-bounce [animation-delay:-0.3s]" />
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-bounce [animation-delay:-0.15s]" />
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" />
              </div>
              <p className="text-amber-700 font-semibold">We're making your order</p>
              <p className="text-amber-600 text-xs mt-1">This page refreshes automatically</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
