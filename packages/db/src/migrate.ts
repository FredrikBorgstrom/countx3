import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error('DATABASE_OWNER_URL must point at the database as its owner role');

const client = new SQL(url);
await migrate(drizzle({ client }), { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
await client.close();
console.log(`Migrated ${new URL(url).pathname.slice(1)}`);
