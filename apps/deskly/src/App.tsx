import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { DesklyProvider, useDeskly } from './store/desklyStore';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { ToastContainer } from './components/ToastContainer';
import { CommandPalette } from './components/CommandPalette';
import { Login } from './routes/Login';
import { Dashboard } from './routes/Dashboard';
import { TicketList } from './routes/TicketList';
import { TicketDetail } from './routes/TicketDetail';
import { NewTicketWizard } from './routes/NewTicketWizard';
import { Settings } from './routes/Settings';

// Layout wrapper for authenticated routes
const AppLayout: React.FC = () => {
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const { isAuthenticated } = useDeskly();

  // If user is not authenticated, redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950 text-zinc-100">
      <Navbar onOpenCommandPalette={() => setIsCommandPaletteOpen(true)} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-zinc-950/60 pb-12">
          <Outlet />
        </main>
      </div>

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
      />
      <ToastContainer />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <DesklyProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/tickets" element={<TicketList />} />
            <Route path="/tickets/new" element={<NewTicketWizard />} />
            <Route path="/tickets/:id" element={<TicketDetail />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </DesklyProvider>
  );
};

export default App;
