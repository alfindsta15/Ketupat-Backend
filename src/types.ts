import type { Context } from "hono";
import type { Bindings } from "./config/env";

export interface AdminInfo {
  id: number;
  email: string;
  role: string;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: { admin: AdminInfo };
};

export type AppContext = Context<AppEnv>;
