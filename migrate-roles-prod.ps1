$env:DATABASE_URL = "postgresql://toftal_user:ToftalClip2024SecureDB!@127.0.0.1:5433/toftal_clip"
Get-Content migrate-roles.sql | npx prisma db execute --stdin
