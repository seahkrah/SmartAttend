# SMARTATTEND Backend

Node.js + Express + TypeScript API for SMARTATTEND.

## Setup

### Prerequisites
- Node.js 18+
- PostgreSQL 12+

### Installation

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file with database URL:
```bash
cp .env.example .env
```

Edit `.env` and set your PostgreSQL connection string:
```
DATABASE_URL=postgresql://user:password@localhost:5432/smartattend
```

3. Initialize the database:
```bash
# Make sure PostgreSQL is running
psql -U postgres -c "CREATE DATABASE smartattend;"

# Run migrations
npm run setup
```

Or manually run:
```bash
psql -d smartattend -f src/db/migrations/001_init_schema.sql
```

### Development

Start the server in watch mode:
```bash
npm run dev
```

Server will run on `http://localhost:3000`

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Run compiled server

## Database Schema

The schema includes support for two platforms:

### School Platform
- Users (students, faculty, admins)
- Courses & Departments
- Attendance tracking
- Class schedules
- Semesters

### Corporate Platform
- Users (employees, HR, admins)
- Facial recognition with liveness detection
- Check-in/check-out records
- Location tracking
- Shift management
- Audit logging

## API Routes

### Attendance
- `GET /api/attendance` - Get all attendance records
- `POST /api/attendance` - Mark attendance
- `GET /api/attendance/:userId` - Get user attendance history

### Users
- `GET /api/users` - Get all users
- `POST /api/users` - Create user
- `GET /api/users/:userId` - Get user by ID
- `PUT /api/users/:userId` - Update user

### Health
- `GET /api/health` - Server health check

## Features

✅ PostgreSQL integration with connection pooling
✅ TypeScript for type safety
✅ Dual-platform support (School & Corporate)
✅ Role-based access control (RBAC)
✅ Audit logging
✅ Face recognition readiness (tables prepared)
✅ Comprehensive database schema with indexes

## Environment Variables

```env
DATABASE_URL=postgresql://user:password@localhost:5432/smartattend
PORT=3000
NODE_ENV=development
JWT_SECRET=your_secret_key
CLOUDINARY_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
FRONTEND_URL=http://localhost:5173
```

## Next Steps

- [ ] Implement JWT authentication
- [ ] Add user registration/login endpoints
- [ ] Implement role-based middleware
- [ ] Connect facial recognition API
- [ ] Add real-time WebSocket updates
- [ ] Implement analytics endpoints
