import { createBrowserRouter, Navigate } from "react-router-dom";
import { StartScreen } from "@/features/workspace/StartScreen";
import { Workspace } from "@/features/workspace/Workspace";

export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/a/demo" replace /> },
  { path: "/a/demo", element: <StartScreen /> },
  { path: "/a/demo/run", element: <Workspace /> },
]);
