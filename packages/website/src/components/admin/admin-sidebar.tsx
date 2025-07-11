import { IconUsers } from "@tabler/icons-react";
import type * as React from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { NavMain } from "../settings/nav-main";

const adminNavItems = [
  {
    title: "Users",
    url: "/admin/users",
    icon: IconUsers,
  },
];
export function AdminSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <Link to="/admin">
                <ShieldAlert className="!size-5" />
                <span className="font-semibold text-base">Admin</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={adminNavItems} />
      </SidebarContent>
    </Sidebar>
  );
}
