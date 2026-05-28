import { BarChart3, CalendarPlus, LayoutDashboard, Settings, Ticket, Users } from "lucide-react";
import { NavLink } from "react-router-dom";
import Logo from "./Logo";

const links = [
  { label: "Dashboard", to: "/admin", icon: LayoutDashboard },
  { label: "Create Event", to: "/admin/events/new", icon: CalendarPlus },
  { label: "Analytics", to: "/admin", icon: BarChart3, disabled: true },
  { label: "Attendees", to: "/admin", icon: Users, disabled: true },
  { label: "Tickets", to: "/admin", icon: Ticket, disabled: true },
  { label: "Settings", to: "/admin", icon: Settings, disabled: true },
];

export default function AdminSidebar() {
  return (
    <aside className="admin-sidebar">
      <Logo />
      <nav aria-label="Admin navigation">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <NavLink key={link.label} to={link.to} className={({ isActive }) => (isActive && !link.disabled ? "active" : "")}>
              <Icon size={20} />
              <span>{link.label}</span>
              {link.disabled && <small>soon</small>}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
