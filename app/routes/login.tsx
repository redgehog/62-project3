import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect") ?? "/portal";

  function handleLogin(e: { preventDefault: () => void }) {
    e.preventDefault();
    sessionStorage.setItem("loggedIn", "true");
    navigate(redirect);
  }

  return (
    <div className="app-shell">
      <header className="app-header px-6 py-4">
        <div className="topbar-row">
          <div className="topbar-brand">
            <h1 className="brand-link">Boba House</h1>
            <p className="topbar-tagline">Shop Operations Suite</p>
          </div>
          <span className="topbar-chip">Secure Access</span>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="surface-card p-10 w-full max-w-md">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Sign In</h2>
          <p className="text-sm text-slate-500 mb-8">Access your workspace securely.</p>
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
                className="field-input placeholder-slate-400"
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
                className="field-input placeholder-slate-400"
                placeholder="Enter password"
              />
            </div>
            <button
              type="submit"
              className="primary-btn mt-2 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 py-2.5"
            >
              Login
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
