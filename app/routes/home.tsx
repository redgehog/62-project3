import { useState } from "react";
import { useNavigate } from "react-router";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Login — Boba House" },
    { name: "description", content: "Login to the Boba House POS system" },
  ];
}

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  function handleLogin(e: { preventDefault: () => void }) {
    e.preventDefault();
    navigate("/portal");
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-slate-800 px-6 py-4">
        <h1 className="text-white text-xl font-bold tracking-wide">Boba House</h1>
      </header>

      {/* Card */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-10 w-full max-w-sm">
          <h2 className="text-2xl font-bold text-slate-900 mb-8">Sign In</h2>
          <form onSubmit={handleLogin} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="username" className="text-sm font-medium text-slate-700">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="border border-slate-300 rounded-lg px-4 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                placeholder="Enter username"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-sm font-medium text-slate-700">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="border border-slate-300 rounded-lg px-4 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                placeholder="Enter password"
              />
            </div>
            <button
              type="submit"
              className="mt-2 bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 text-white font-semibold rounded-lg py-2 transition-colors"
            >
              Login
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
