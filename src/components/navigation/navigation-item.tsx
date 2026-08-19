import { useParams, useNavigate } from "react-router-dom";

import { cn } from "@/lib/utils";
import { ActionTooltip } from "@/components/action-tooltip";

interface NavigationItemProps {
  id: string;
  imageUrl: string;
  name: string;
}

export const NavigationItem = ({
  id,
  imageUrl,
  name
}: NavigationItemProps) => {
  const params = useParams();
  const navigate = useNavigate();

  const onClick = () => {
    navigate(`/servers/${id}`);
  };

  const isSelected = params?.serverId === id;

  return (
    <ActionTooltip
      side="right"
      align="center"
      label={name}
    >
      <button
        onClick={onClick}
        className="group relative flex items-center"
      >
        <div className={cn(
          "absolute left-0 bg-primary rounded-r-full transition-all w-[4px]",
          !isSelected && "group-hover:h-[20px]",
          isSelected ? "h-[36px]" : "h-[8px]"
        )} />
        <div className={cn(
          "relative group flex mx-3 h-[48px] w-[48px] rounded-[24px] group-hover:rounded-[16px] transition-all overflow-hidden",
          isSelected && "bg-primary/10 text-primary rounded-[16px]"
        )}>
          <img
            src={imageUrl}
            alt={name}
            className="w-full h-full object-cover"
          />
        </div>
      </button>
    </ActionTooltip>
  );
};
