import { useState, useEffect } from "react";
import { useMockStore } from "@/lib/mock-store";
import { useParams } from "react-router-dom";

export interface ConnectionStatuses {
  irc: boolean;
  ircError: string | null;
  resourceServer: boolean;
  internet: boolean;
}

export const useConnectionStatus = (): ConnectionStatuses => {
  const { serverId } = useParams();
  const servers = useMockStore((state) => state.servers);
  const ircConnectedServers = useMockStore((state) => state.ircConnectedServers);
  const ircConnectionErrors = useMockStore((state) => state.ircConnectionErrors);
  const uploadConfig = useMockStore((state) => state.uploadConfig);

  const activeServerId = serverId || (servers.length > 0 ? servers[0].id : null);
  const isIrcConnected = activeServerId ? !!ircConnectedServers[activeServerId] : Object.values(ircConnectedServers).some(Boolean);
  const activeIrcError = activeServerId ? (ircConnectionErrors[activeServerId] || null) : null;

  const [isInternetConnected, setIsInternetConnected] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  const [isResourceServerConnected, setIsResourceServerConnected] = useState<boolean>(true);

  // Internet status listener
  useEffect(() => {
    const handleOnline = () => setIsInternetConnected(true);
    const handleOffline = () => setIsInternetConnected(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Resource server health check ping
  useEffect(() => {
    let isMounted = true;

    const checkResourceServer = async () => {
      if (uploadConfig.provider === "disabled") {
        // No upload provider means the application has no resource-server dependency.
        if (isMounted) setIsResourceServerConnected(true);
        return;
      }

      let checkUrl = "https://pomf.cat/upload.php";
      if (uploadConfig.provider === "litterbox") {
        checkUrl = "https://litterbox.catbox.moe";
      } else if (uploadConfig.provider === "pomf" && uploadConfig.pomfUrl) {
        checkUrl = uploadConfig.pomfUrl;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      try {

        // GET is more widely supported than HEAD by upload hosts and WebView2.
        await fetch(checkUrl, {
          method: "GET",
          mode: "no-cors",
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        if (isMounted) setIsResourceServerConnected(true);
      } catch (error) {
        clearTimeout(timeoutId);
        if (isMounted) setIsResourceServerConnected(false);
      }
    };

    checkResourceServer();
    const interval = setInterval(checkResourceServer, 30000); // Re-check every 30s

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [uploadConfig.provider, uploadConfig.pomfUrl]);

  return {
    irc: isIrcConnected,
    ircError: activeIrcError,
    resourceServer: isResourceServerConnected,
    internet: isInternetConnected,
  };
};
