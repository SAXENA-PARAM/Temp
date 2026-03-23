import { Pool } from "pg";

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: process.env.DB_NAME ,
  password: process.env.DB_PASSWORD ,
  port: 5433 
});


pool.on("error", (err) => {
  console.error("Unexpected database error", err);
});


export { pool };