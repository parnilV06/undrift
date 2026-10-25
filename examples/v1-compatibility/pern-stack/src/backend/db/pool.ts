// PostgreSQL connection pool configuration (static source representation)
export const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: "pern_demo",
  user: "postgres"
};
