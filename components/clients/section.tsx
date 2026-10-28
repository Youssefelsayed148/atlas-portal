import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Lock } from "lucide-react";

export function Section({
  title,
  icon,
  children,
  visible,
  hiddenWhenRestricted,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  visible: boolean;
  hiddenWhenRestricted: boolean;
}) {
  if (!visible && hiddenWhenRestricted) {
    return null;
  }

  if (!visible) {
    return (
      <Card className="border-border bg-card/60 opacity-60 saturate-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-muted-foreground">
            <Lock className="size-4" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This section is restricted for your role.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
