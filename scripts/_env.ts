// Side-effect import: load .env.local before any module that reads process.env
// at import time (lib/config). Must be the FIRST import in every script.
import { config } from "dotenv";
config({ path: process.env.DOTENV_PATH ?? ".env.local" });
