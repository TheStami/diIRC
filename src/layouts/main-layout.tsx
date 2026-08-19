import { useParams, Outlet, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { NavigationSidebar } from "@/components/navigation/navigation-sidebar";
import { ServerSidebar } from "@/components/server/server-sidebar";
import { useMockStore } from "@/lib/mock-store";
import { useUIStore } from "@/hooks/use-ui-store";
import { cn } from "@/lib/utils";

export const MainLayout = () => {
  const { serverId } = useParams();
  const servers = useMockStore((state) => state.servers);
  const navigate = useNavigate();
  const showNavigationSidebar = useUIStore((state) => state.showNavigationSidebar);
  const showServerSidebar = useUIStore((state) => state.showServerSidebar);

  const activeServer = servers.find((s) => s.id === serverId) || servers[0];

  useEffect(() => {
    if (!servers || servers.length === 0) {
      navigate("/", { replace: true });
    } else if (!activeServer) {
      navigate(`/servers/${servers[0].id}`, { replace: true });
    }
  }, [serverId, activeServer, servers, navigate]);

  if (!activeServer) {
    return null;
  }

  // Calculate dynamic left padding for main content
  let mainPaddingClass = "md:pl-0";
  if (showNavigationSidebar && showServerSidebar) {
    mainPaddingClass = "md:pl-[312px]";
  } else if (!showNavigationSidebar && showServerSidebar) {
    mainPaddingClass = "md:pl-[240px]";
  } else if (showNavigationSidebar && !showServerSidebar) {
    mainPaddingClass = "md:pl-[72px]";
  }

  return (
    <div className="h-full">
      {showNavigationSidebar && (
        <div className="hidden md:flex h-full w-[72px] z-30 flex-col fixed inset-y-0 left-0">
          <NavigationSidebar />
        </div>
      )}
      {showServerSidebar && (
        <div className={cn(
          "hidden md:flex h-full w-60 z-20 flex-col fixed inset-y-0 transition-all duration-200",
          showNavigationSidebar ? "left-[72px]" : "left-0"
        )}>
          <ServerSidebar serverId={activeServer.id} />
        </div>
      )}
      <main className={cn(
        "h-full transition-all duration-200",
        mainPaddingClass
      )}>
        <Outlet />
      </main>
    </div>
  );
};
