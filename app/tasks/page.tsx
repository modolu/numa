import type { Metadata } from "next";
import { TasksRoute } from "@/components/tasks/TasksRoute";

export const metadata: Metadata = { title: "Tasks" };

export default function TasksPage() {
  return <TasksRoute />;
}
