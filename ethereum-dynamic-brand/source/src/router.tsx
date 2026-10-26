import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routes/root";

const basepath = import.meta.env.BASE_URL.replace(/\/$/, "");

export const router = createRouter({
  basepath,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  routeTree,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
