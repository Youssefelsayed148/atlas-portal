import { config } from "dotenv";
import path from "path";

// dotenv never overrides variables that are already set, so .env.local wins
// over .env.production when both define the same key.
config({ path: path.resolve(__dirname, "..", ".env.local") });
config({ path: path.resolve(__dirname, "..", ".env.production") });
