import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { WebsiteTaskCreateEvent } from "@ragdoll/common";
import { createFileRoute } from "@tanstack/react-router";
import { LifeBuoy, Loader2, Puzzle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";

const searchSchema = z.object({
  uid: z.string().optional(),
  url: z.string(),
  event: z.custom<WebsiteTaskCreateEvent>((o) => o),
});

export const Route = createFileRoute("/_authenticated/redirect-vscode")({
  validateSearch: (search) => searchSchema.parse(search),
  component: RouteComponent,
});

function RouteComponent() {
  const { url, event } = Route.useSearch();
  const [showManualButton, setShowManualButton] = useState(false);
  const isVscode = url.startsWith("vscode://");

  const description = useMemo(() => {
    if (event) {
      return (
        event.data.prompt?.split("\n")[0] || "Creating new project locally..."
      );
    }
    return "null";
  }, [event]);

  const openRedirectUrl = useCallback(() => {
    window.open(url);
  }, [url]);

  useEffect(() => {
    const delay = isVscode ? 1000 : 8000;

    const redirectTimeoutHandle = setTimeout(() => {
      openRedirectUrl();
      setShowManualButton(true);
    }, delay);

    return () => {
      clearTimeout(redirectTimeoutHandle);
    };
  }, [openRedirectUrl, isVscode]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted/30">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="items-center text-center">
          <CardTitle className="flex items-center justify-center gap-1">
            {!showManualButton && (
              <Loader2 className="size-4 animate-spin text-primary" />
            )}
            <span>Starting Task</span>
          </CardTitle>
          <CardDescription className="mt-1 text-xs italic">
            {description}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {isVscode && (
            <div className="flex items-start gap-3 rounded-md border p-3">
              <Puzzle className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" />
              <p>Ensure the Pochi VS Code extension is installed.</p>
            </div>
          )}
          <div className="flex items-start gap-3 rounded-md border p-3">
            <LifeBuoy className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-500" />
            <p>
              If you encounter issues, refer to the documentation or contact
              support.
            </p>
          </div>
        </CardContent>
        {showManualButton && (
          <CardFooter className="flex items-center justify-center">
            <p className="mb-2 text-muted-foreground text-xs">
              {/* Differentiate between VSCode and Minion */}
              If {isVscode ? "VS Code" : "task"} doesn't open automatically,
              click{" "}
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                here
              </a>
            </p>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
