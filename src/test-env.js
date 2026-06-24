// Set env vars before any module is loaded so the config package picks them up.
process.env.JWT_SECRET = "test-secret";
process.env.AUTH_USERNAME = "matthew";
process.env.AUTH_PASSWORD = "beyer";
