import { NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, Settings } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'

const navItems = [
  { title: 'Dashboard', href: '/', icon: LayoutDashboard },
  { title: 'Settings', href: '/settings', icon: Settings },
] as const

export default function AppSidebar() {
  const location = useLocation()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="py-3 border-b border-sidebar-border/50">
        <div className="flex w-full items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <div className="size-8 shrink-0 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
            A
          </div>
          <span className="font-semibold text-[1.09375rem] truncate group-data-[collapsible=icon]:hidden">
            Helix
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  item.href === '/'
                    ? location.pathname === '/'
                    : location.pathname.startsWith(item.href)

                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      render={(<NavLink to={item.href} />) as any}
                      isActive={isActive}
                      tooltip={item.title}
                      className="text-[1.09375rem]"
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  )
}
