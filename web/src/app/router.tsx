import { createBrowserRouter, Navigate } from "react-router-dom";
import { StartScreen } from "@/features/workspace/StartScreen";
import { Workspace } from "@/features/workspace/Workspace";
import { Landing } from "@/features/landing/Landing";

export const router = createBrowserRouter([
  { path: "/", element: <Landing /> },
  { path: "/app", element: <Workspace /> },
  // Legacy demo paths keep working (redirect-safe for bookmarks/tests).
  { path: "/a/demo", element: <StartScreen /> },
  { path: "/a/demo/run", element: <Workspace /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);
