import ReactDOM from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../theme/ThemeProvider'
import { ShellPreview } from './ShellPreview'
import { useAuthStore } from '../store/authStore'
import '../index.css'

// Seed a user so the shell renders as it would for a signed-in school admin.
useAuthStore.setState({
  user: { id: 'preview', email: 'a.nyepan@ul.edu.lr', fullName: 'Agnes Nyepan', role: 'School Admin', platform: 'school' },
  token: 'preview', isLoading: false,
} as never)
ReactDOM.createRoot(document.getElementById('root')!).render(
  <ThemeProvider><MemoryRouter initialEntries={["/dashboard"]}><ShellPreview /></MemoryRouter></ThemeProvider>
)
