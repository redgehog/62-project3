import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("manager-login", "routes/manager-login.tsx"),
  route("sign-in/*", "routes/sign-in.tsx"),
  route("sign-up/*", "routes/sign-up.tsx"),
  route("cashier-login", "routes/cashier-login.tsx"),
  route("portal", "routes/portal.tsx"),
  route("manager", "routes/manager.tsx"),
  route("cashier", "routes/cashier.tsx"),
  route("customer", "routes/customer.tsx"),
  route("menu-board", "routes/menu-board.tsx"),
  route("api/weather", "routes/api.weather.ts"),
  route("kitchen", "routes/kitchen.tsx"),
] satisfies RouteConfig;
