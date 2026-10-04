import { execSync } from "child_process";
import fs from "fs";

export default function setup() {
  if (process.env.SKIP_DB_SETUP) return; // for environments without Prisma engines (unit tests only)
  // Fresh SQLite test database built from the Prisma schema.
  ["prisma/test.db", "prisma/test.db-journal"].forEach((f) => fs.existsSync(f) && fs.rmSync(f));
  execSync("npx prisma db push --skip-generate --force-reset", {
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
  });
}
