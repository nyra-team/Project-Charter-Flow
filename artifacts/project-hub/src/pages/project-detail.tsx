import { useRoute } from "wouter";
import { useGetProject, useListMilestones, useListTasks, useGetBurndown, useGetCriticalPath } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "../lib/format";
import { StatusBadge } from "../components/status-badge";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

export default function ProjectDetail() {
  const [, params] = useRoute("/projects/:id");
  const projectId = parseInt(params?.id || "0");

  const { data: project, isLoading: loadingProject } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: milestones } = useListMilestones(projectId, { query: { enabled: !!projectId } });
  const { data: tasks } = useListTasks(projectId, { query: { enabled: !!projectId } });
  const { data: burndown } = useGetBurndown(projectId, { query: { enabled: !!projectId } });
  const { data: criticalPath } = useGetCriticalPath(projectId, { query: { enabled: !!projectId } });

  if (loadingProject) {
    return <div className="space-y-4"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  }
  if (!project) return <div>Project not found</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">{project.name}</h1>
          <div className="flex items-center gap-4 text-muted-foreground text-sm">
            <StatusBadge status={project.status} />
            <span>Timeline: {formatDate(project.startDate)} - {formatDate(project.endDate)}</span>
          </div>
        </div>
        <Link href={`/projects/${project.id}/tasks/new`}>
          <Button>Add Task</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium">Overall Progress</span>
            <span className="font-bold">{project.progress}%</span>
          </div>
          <Progress value={project.progress} className="h-3" />
        </CardContent>
      </Card>

      <Tabs defaultValue="tasks">
        <TabsList>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="milestones">Milestones</TabsTrigger>
          <TabsTrigger value="critical-path">Critical Path</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>
        
        <TabsContent value="tasks" className="mt-4 space-y-4">
          <Card>
            <CardContent className="p-0">
              {tasks?.length ? (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="text-left py-3 px-4">Task Name</th>
                      <th className="text-left py-3 px-4">Assignee</th>
                      <th className="text-center py-3 px-4">Status</th>
                      <th className="text-center py-3 px-4">Priority</th>
                      <th className="text-right py-3 px-4">Est. Hours</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {tasks.map(t => (
                      <tr key={t.id} className="hover:bg-muted/30">
                        <td className="py-3 px-4 font-medium">{t.name}</td>
                        <td className="py-3 px-4">{t.assigneeName || "Unassigned"}</td>
                        <td className="py-3 px-4 text-center"><StatusBadge status={t.status} /></td>
                        <td className="py-3 px-4 text-center">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${t.priority === 'critical' ? 'bg-red-100 text-red-800' : t.priority === 'high' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-800'}`}>
                            {t.priority}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">{t.estimatedHours || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="p-6 text-center text-muted-foreground">No tasks added yet.</div>}
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="milestones" className="mt-4">
          <div className="space-y-4">
            {milestones?.map(m => (
              <Card key={m.id}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-lg">{m.name}</CardTitle>
                    <StatusBadge status={m.status} />
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">{m.description || "No description"}</p>
                  <p className="text-xs font-medium">Due: {formatDate(m.dueDate)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="critical-path" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Critical Path Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              {criticalPath?.criticalTasks?.length ? (
                <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-300 before:to-transparent">
                  {criticalPath.criticalTasks.map((t, idx) => (
                    <div key={t.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                      <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-red-100 text-red-600 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                        {idx + 1}
                      </div>
                      <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded border border-red-200 bg-red-50/50 shadow">
                        <div className="flex items-center justify-between space-x-2 mb-1">
                          <div className="font-bold text-slate-900">{t.name}</div>
                          <time className="text-xs font-medium text-red-600">{t.estimatedHours}h</time>
                        </div>
                        <div className="text-slate-500 text-sm">
                          {formatDate(t.startDate)} - {formatDate(t.endDate)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-muted-foreground">Critical path not available.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Burndown Chart</CardTitle>
            </CardHeader>
            <CardContent className="h-[400px]">
              {burndown?.dataPoints && burndown.dataPoints.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={burndown.dataPoints} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={(v) => formatDate(v)} />
                    <YAxis />
                    <Tooltip labelFormatter={(v) => formatDate(v)} />
                    <Legend />
                    <Line type="monotone" dataKey="ideal" stroke="#94a3b8" strokeDasharray="5 5" name="Ideal Remaining" />
                    <Line type="monotone" dataKey="remaining" stroke="#4f46e5" strokeWidth={2} name="Actual Remaining" />
                  </LineChart>
                </ResponsiveContainer>
              ) : <div className="h-full flex items-center justify-center text-muted-foreground">No burndown data available</div>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
