import type { Route } from "./+types/kitchen";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Kitchen" }];
}

export default function Kitchen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white rounded-2xl shadow-lg p-10">
        <h1 className="text-2xl font-bold text-gray-800">Kitchen</h1>
      </div>
    </div>
  );
}
