import { Outlet } from 'react-router-dom'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RunProvider } from '@/context/RunContext'
import AppSidebar from './AppSidebar'
import Header from './Header'

export default function AppLayout() {
  return (
    <RunProvider>
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset className="flex flex-col min-h-svh">
            <Header />
            <div className="flex-1 overflow-auto">
              <Outlet />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </RunProvider>
  )
}
