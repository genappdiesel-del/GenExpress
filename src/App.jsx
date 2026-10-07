import React, { useEffect, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom'
import SuperAdminPortal from './portals/SuperAdminPortal'
import SupplierPortal from './portals/SupplierPortal'
import ClientPortal from './portals/ClientPortal'
import AgentPortal from './portals/AgentPortal'
import './index.css'

interface UserSession {
  role: 'super_admin' | 'supplier' | 'client' | 'agent' | null
  fullName: string
  id: string
  isAuthenticated: boolean
}

function App() {
  const [user, setUser] = useState<UserSession>({
    role: null,
    fullName: '',
    id: '',
    isAuthenticated: false,
  })
  const navigate = useNavigate()

  useEffect(() => {
    const session = localStorage.getItem('genapp_session')
    if (session) {
      try {
        const parsed = JSON.parse(session)
        setUser({
          role: parsed.role,
          fullName: parsed.fullName,
          id: parsed.id,
          isAuthenticated: true,
        })
      } catch (e) {
        localStorage.removeItem('genapp_session')
      }
    }
  }, [])

  useEffect(() => {
    if (user.isAuthenticated) {
      switch (user.role) {
        case 'super_admin':
          navigate('/super-admin', { replace: true })
          break
        case 'supplier':
          navigate('/supplier', { replace: true })
          break
        case 'client':
          navigate('/client', { replace: true })
          break
        case 'agent':
          navigate('/agent', { replace: true })
          break
        default:
          navigate('/', { replace: true })
      }
    }
  }, [user.isAuthenticated, navigate])

  if (!user.isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 text-center max-w-md w-full">
          <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M8 14l2-8 14 5-2 8-14-5z"/>
            </svg>
          </div>
          <h2 className="text-2xl font-bold mb-3">GenExpress</h2>
          <p className="text-gray-600 mb-6">Supply Chain Transaction Tracker</p>
          <button
            onClick={() => {
              const mockSession = {
                role: 'super_admin',
                fullName: 'Super Administrator',
                id: 'supa-demo-id',
              }
              localStorage.setItem('genapp_session', JSON.stringify(mockSession))
              navigate('/super-admin', { replace: true })
            }}
            className="bg-primary text-white px-6 py-3 rounded-md font-medium hover:bg-primary/90 transition-colors">
            Continue as Super Admin (Demo)
          </button>
        </div>
      </div>
    )
  }

  return (
    <Router>
      <Routes>
        <Route path="/" exact>
          <div className="min-h-screen bg-gray-50 p-4">
            <h1 className="text-3xl font-bold mb-4">GenExpress</h1>
            <p className="text-gray-600">Supply Chain Transaction Tracker</p>
            <div className="grid grid-cols-1 gap-3 mb-6">
              <button
                onClick={() => {
                  const mockSession = {
                    role: 'super_admin',
                    fullName: 'Super Administrator',
                    id: 'supa-demo-id',
                  }
                  localStorage.setItem('genapp_session', JSON.stringify(mockSession))
                  navigate('/super-admin', { replace: true })
                }}
                className="bg-primary text-white px-4 py-3 rounded-md font-medium hover:bg-primary/90 transition-colors w-full">
                Log in as Super Admin
              </button>
              <button
                onClick={() => {
                  const mockSession = {
                    role: 'supplier',
                    fullName: 'Test Supplier',
                    id: 'supplier-demo-id',
                  }
                  localStorage.setItem('genapp_session', JSON.stringify(mockSession))
                  navigate('/supplier', { replace: true })
                }}
                className="bg-green-600 text-white px-4 py-3 rounded-md font-medium hover:bg-green-700 transition-colors w-full">
                Log in as Supplier
              </button>
              <button
                onClick={() => {
                  const mockSession = {
                    role: 'client',
                    fullName: 'Test Client',
                    id: 'client-demo-id',
                  }
                  localStorage.setItem('genapp_session', JSON.stringify(mockSession))
                  navigate('/client', { replace: true })
                }}
                className="bg-blue-600 text-white px-4 py-3 rounded-md font-medium hover:bg-blue-700 transition-colors w-full">
                Log in as Client
              </button>
              <button
                onClick={() => {
                  const mockSession = {
                    role: 'agent',
                    fullName: 'Test Agent',
                    id: 'agent-demo-id',
                  }
                  localStorage.setItem('genapp_session', JSON.stringify(mockSession))
                  navigate('/agent', { replace: true })
                }}
                className="bg-orange-600 text-white px-4 py-3 rounded-md font-medium hover:bg-orange-700 transition-colors w-full">
                Log in as Agent
              </button>
            </div>
          </div>
        </Route>
        <Route path="/super-admin" element={<SuperAdminPortal user={user} />} />
        <Route path="/supplier" element={<SupplierPortal user={user} />} />
        <Route path="/client" element={<ClientPortal user={user} />} />
        <Route path="/agent" element={<AgentPortal user={user} />} />
      </Routes>
    </Router>
  )
}

export default App