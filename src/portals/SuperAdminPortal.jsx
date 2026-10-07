import React from 'react'

interface SuperAdminPortalProps {
  user: {
    role: string
    fullName: string
    id: string
  }
}

const SuperAdminPortal: React.FC<SuperAdminPortalProps> = ({ user }) => {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-bold">
              {user.fullName.split(' ')[0][0]}
            </div>
            <div>
              <h1 className="text-lg font-semibold">Welcome, {user.fullName}</h1>
              <p className="text-sm text-gray-600">Super Administrator</p>
            </div>
          </div>
          <button onClick={() => alert('Logout')} className="hidden sm:block px-4 py-2 bg-red-100 text-red-800 rounded-md text-sm font-medium hover:bg-red-200">
            Logout
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto p-4 overflow-y-auto">
        <h2 className="text-2xl font-bold mb-6">Dashboard</h2>
        <p className="text-gray-600">Super Admin Dashboard - Under Construction</p>
      </main>

      <footer className="bg-white border-t border-gray-200 pt-4">
        <div className="max-w-7xl mx-auto px-4 py-2 flex flex-col sm:flex-row gap-2">
          <a href="/" className="flex-1 flex flex-col items-center py-2 px-3 text-sm font-medium hover:text-blue-600 transition-colors">
            <svg className="w-4 h-4 mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12l2-8 13-2v12-6L3 12z"/></svg>
            Home
          </a>
          <a href="/supplier" className="flex-1 flex flex-col items-center py-2 px-3 text-sm font-medium hover:text-green-600 transition-colors">Supplier</a>
          <a href="/client" className="flex-1 flex flex-col items-center py-2 px-3 text-sm font-medium hover:text-green-600 transition-colors">Client</a>
          <a href="/agent" className="flex-1 flex flex-col items-center py-2 px-3 text-sm font-medium hover:text-green-600 transition-colors">Agent</a>
        </div>
      </footer>
    </div>
  )
}

export default SuperAdminPortal