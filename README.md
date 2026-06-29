# 🏢 HaloSchool - Multi-Tenant School Management System

## Quick Start

### Prerequisites
- Node.js 14+
- SQLite3

### Installation

```bash
# Install dependencies
npm install

# Run database migration
sqlite3 school.db < backend/migrations/001-school-name-id.sql

# Start development server
npm run dev
```

### Deployment (Railway)

```bash
git add .
git commit -m "feat: Deploy HaloSchool"
git push origin main
```

Railway automatically:
1. Builds Docker image
2. Installs dependencies
3. Starts server
4. Runs healthcheck

## Features

✅ Multi-tenant school management
✅ User enrollment with auto-generated links
✅ Role-based access control
✅ Complete school isolation
✅ Beautiful responsive dashboards
✅ REST API with 14+ endpoints

## Architecture

- **Backend:** Node.js + Express
- **Database:** SQLite3
- **Frontend:** HTML + CSS + JavaScript
- **Authentication:** JWT
- **Deployment:** Railway + Docker

## API Endpoints

- `POST /api/login` - User login
- `POST /api/school/signup` - Register school
- `GET /api/enrollment-data` - Get enrollment details
- `POST /api/enroll` - Complete enrollment
- And 10+ more...

See `public/` for frontend files and `docs/` for detailed documentation.

## Support

Check `docs/` folder for:
- Implementation guide
- Testing procedures
- Rollback instructions

