import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("portal", "routes/portal.tsx"),
  route("manager", "routes/manager.tsx"),
  route("cashier", "routes/cashier.tsx"),
  route("customer", "routes/customer.tsx"),
  route("menu-board", "routes/menu-board.tsx"),
  route("kitchen", "routes/kitchen.tsx"),
] satisfies RouteConfig;
