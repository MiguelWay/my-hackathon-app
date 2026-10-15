import { runMigrations } from "./migrations";

runMigrations()
  .then(() => console.log("migrations complete"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
