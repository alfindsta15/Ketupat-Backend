#!/bin/sh
set -e
# Apply migrations if they exist; otherwise create the schema directly.
if [ -d prisma/migrations ]; then
  npx prisma migrate deploy
else
  npx prisma db push
fi
npx tsx prisma/seed.ts
exec node dist/server.js
