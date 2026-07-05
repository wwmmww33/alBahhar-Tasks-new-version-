// src/layouts/MainLayout.tsx
import React from 'react';
import { useLocation } from 'react-router-dom';
import Navbar from '../components/Navbar';
import SidebarCalendar from '../components/SidebarCalendar';
import SubtaskReminder from '../components/SubtaskReminder';
import type { CurrentUser } from '../types';

type MainLayoutProps = {
  children: React.ReactNode;
  currentUser: CurrentUser;
  onLogout: () => void;
};

const MainLayout = ({ children, currentUser, onLogout }: MainLayoutProps) => {
  const location = useLocation();
  const hideSidebarCalendar = location.pathname.startsWith('/calendar');

  return (
    // --- تم نقل كلاسات الثيم إلى هنا ---
    <div className="bg-bkg text-content min-h-screen">
      <Navbar currentUser={currentUser} onLogout={onLogout} />
      <div className="flex">
        {!hideSidebarCalendar && <SidebarCalendar currentUser={currentUser} />}
        <main className="flex-1 p-8">
          {children}
        </main>
      </div>
      <SubtaskReminder currentUser={currentUser} />
      <footer dir="ltr" className="text-center py-3 text-xs text-gray-400 dark:text-gray-600 select-none border-t border-gray-100 dark:border-gray-800">
        ///ARAJHI©2026
      </footer>
    </div>
  );
};

export default MainLayout;
