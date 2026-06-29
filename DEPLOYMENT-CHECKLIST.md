# ✅ Deployment Checklist

## Before Committing

- [x] Dockerfile in repository root
- [x] package.json in repository root
- [x] server.js in repository root
- [x] railway.json with correct paths
- [x] public/ directory with all HTML files
- [x] backend/migrations/ directory with SQL
- [x] .gitignore created
- [x] No files in subdirectories

## Testing Locally

```bash
npm install
npm start
```

Verify:
- Server starts without errors
- Healthcheck responds: `curl http://localhost:5000/api/health`
- Port 5000 is listening

## Deploying to Railway

```bash
git add .
git commit -m "fix: Corrected directory structure for Railway"
git push origin main
```

## After Deployment

Monitor at: https://railway.app

Check:
- Build completes successfully
- Deployment finishes
- Status shows "Online"
- Healthcheck passes

Test:
```bash
curl https://your-app.up.railway.app/api/health
```

Should return: `{"status":"ok","timestamp":"..."}`

