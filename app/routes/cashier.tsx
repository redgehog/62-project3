import type { Route } from "./+types/cashier";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Cashier" }];
}

export default function Cashier() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white rounded-2xl shadow-lg p-10">
        <h1 className="text-2xl font-bold text-gray-800">Cashier</h1>
      </div>
    </div>
  );
}
