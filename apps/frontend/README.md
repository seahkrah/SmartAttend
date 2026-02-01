# SmartAttend Frontend

A modern, clean, and stylish web application built with React, TypeScript, Tailwind CSS, and Vite. Designed to work seamlessly with the SmartAttend backend API.

## 🎨 Features

- **Modern UI/UX**: Built with Tailwind CSS and Lucide React icons
- **Responsive Design**: Works perfectly on desktop, tablet, and mobile
- **Dark Theme**: Eye-friendly dark mode with gradient accents
- **Component-Based**: Reusable, well-organized React components
- **Type-Safe**: Full TypeScript support
- **State Management**: Zustand for simple, efficient state management
- **Routing**: React Router v6 for client-side navigation
- **API Integration**: Axios pre-configured for backend communication

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ installed
- npm or yarn package manager
- Backend API running on `http://localhost:5000`

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 📁 Project Structure

```
src/
├── pages/
│   ├── LandingPage.tsx      # Public landing page
│   ├── LoginPage.tsx        # User login
│   ├── RegisterPage.tsx     # User registration
│   └── DashboardPage.tsx    # Main dashboard (protected)
├── components/
│   └── Navigation.tsx       # Sidebar and topbar components
├── store/
│   └── authStore.ts         # Zustand auth state
├── App.tsx                  # Router setup
├── main.tsx                 # Entry point
└── index.css                # Tailwind CSS & custom styles
```

## 🎯 Color Palette

The app uses a sophisticated color scheme:

- **Primary**: Blue (#5d7fff to #3d48ff) - Main brand color
- **Secondary**: Purple (#8b5cf6 to #6d28d9) - Accent color
- **Accent**: Green (#22c55e to #15803d) - Success/positive states
- **Background**: Dark slate gradient (slate-950 to slate-800)

## 📄 Pages

### Landing Page (`/`)
- Public homepage showcasing SmartAttend features
- Call-to-action buttons for login/signup
- Feature cards highlighting platform capabilities

### Login Page (`/login`)
- User authentication form
- Email and password input
- Error handling and loading states

### Register Page (`/register`)
- New user registration
- Platform selection (School/Corporate)
- Form validation

### Dashboard (`/dashboard`)
- Protected route (requires authentication)
- Attendance statistics cards
- Quick action buttons
- Navigation sidebar
- Real-time user information

## 🔐 Authentication

The app uses JWT token-based authentication:

1. User logs in via `/api/auth/login`
2. Backend returns JWT token
3. Token stored in localStorage
4. Subsequent API requests include the token
5. Protected routes check for valid token

## 🛠️ Available Scripts

```bash
npm run dev       # Start development server (port 5173)
npm run build     # Build for production
npm run preview   # Preview production build locally
```

## 🔗 API Integration

The frontend is configured to communicate with the backend at `http://localhost:5000`. Proxy configuration is set in `vite.config.ts`:

```typescript
proxy: {
  '/api': {
    target: 'http://localhost:5000',
    changeOrigin: true,
  },
}
```

## 📦 Key Dependencies

- **React 18** - UI library
- **React Router v6** - Client-side routing
- **Zustand** - State management
- **Axios** - HTTP client
- **Tailwind CSS** - Utility-first CSS framework
- **Lucide React** - Icon library
- **TypeScript** - Type safety
- **Vite** - Build tool

## 🎬 Development Workflow

1. Start the backend server: `npm run dev` in `/apps/backend`
2. Start the frontend dev server: `npm run dev` in `/apps/frontend`
3. Open `http://localhost:5173` in your browser
4. Navigate to landing page, login, or register

## 📝 Notes

- The landing page includes placeholder logos from `/public/logos/`
- All forms have client-side validation
- Loading states are shown during API calls
- Error messages are displayed to users
- Mobile responsiveness is built-in
- Smooth animations and transitions throughout

## 🚀 Production Build

```bash
npm run build
# Output will be in the `dist/` directory
```

The production build is optimized with:
- Code splitting
- Minified CSS/JS
- Tree-shaking
- Asset optimization

## 📞 Support

For issues or questions, refer to the main project README in `/README.md`
